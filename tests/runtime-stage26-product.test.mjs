import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeKnowledgeCandidate, listKnowledge, reviewKnowledge, retrieveKnowledge } from '../intelligence/assessment/knowledge-lifecycle.mjs';
import { collectKnowledgeFacts } from '../intelligence/assessment/knowledge.mjs';
import { SOURCE_KINDS, normalizeCandidate, assessDiscoveryCandidate, discoverCandidate, listDiscovery } from '../intelligence/capability/discovery.mjs';
import { projectStatus, nextProjectAction, completeProjectTask } from '../intelligence/orchestrator/product-workflow.mjs';
import { runProductCli, formatProductResult } from '../cli/forgeos.mjs';
import { createTaskCandidate } from '../intelligence/assessment/task-candidate.mjs';
import { createHostHandoff, computeHandoffIntegrity } from '../intelligence/orchestrator/host-handoff.mjs';
import { portabilityScanText } from '../scripts/release/project-artifact-portability.mjs';
import { evaluateScopedTaskTool } from '../policy/authority.mjs';
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'forgeos-s26-'));
  fs.mkdirSync(path.join(root,'docs'),{recursive:true});fs.mkdirSync(path.join(root,'src'));
  fs.writeFileSync(path.join(root,'AGENTS.md'),'# Project guidance\n');
  fs.writeFileSync(path.join(root,'docs/proof.md'),'# Evidence\n');
  fs.writeFileSync(path.join(root,'src/a.js'),'export const a = 1;\n');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;
}
const input = {id:'lesson-1',text:'Documentation guidance is checked independently.',source:'codex',evidence_refs:['docs/proof.md'],capability_id:'documentation-sync'};
const human = {kind:'human',id:'test-operator',confirmed:true};
const candidate = {candidate_id:'example-1',source_kind:'OSS_LIBRARY',name:'Example',description:'Inert fixture only',source:'test',url:'https://example.org/source',revision:'abc123',license:'MIT',
  discovered_at:'2026-01-01T00:00:00Z',expires_at:'2099-01-01T00:00:00Z',claims:['parse'],requirements:{network:false,docker:false,external_runtime:false},provenance:{observer:'test',evidence:'Controlled local fixture'}};
test('candidate is unreviewed, current, local; write/review never change fact fingerprint',t=>{
  const root=fixture(t), before=collectKnowledgeFacts(root).fingerprint;
  const r=writeKnowledgeCandidate(root,input);assert.equal(r.candidate.review_status,'UNREVIEWED');assert.equal(r.candidate.state,'CURRENT');
  assert.equal(collectKnowledgeFacts(root).fingerprint,before);assert.equal(retrieveKnowledge(root).items.length,0);
  reviewKnowledge(root,input.id,'ACCEPTED',human,'Controlled operator simulation');
  assert.equal(retrieveKnowledge(root).items.length,1);assert.equal(collectKnowledgeFacts(root).fingerprint,before);
  assert.equal(listKnowledge(root).interpretations[0].authoritative,false);
});
test('no agent self-promotion or absent explicit confirmation',t=>{
  const root=fixture(t);writeKnowledgeCandidate(root,input);
  for(const actor of [{...human,kind:'agent'},{...human,confirmed:false},{...human,id:'codex'}])assert.throws(()=>reviewKnowledge(root,input.id,'ACCEPTED',actor,'test'));
  assert.throws(()=>writeKnowledgeCandidate(root,{...input,id:'x',review_status:'ACCEPTED'}));
});
test('review history retained and rejection excludes retrieval',t=>{
  const root=fixture(t);writeKnowledgeCandidate(root,input);reviewKnowledge(root,input.id,'ACCEPTED',human,'Simulation');reviewKnowledge(root,input.id,'REJECTED',human,'Rejected simulation');
  const row=listKnowledge(root).interpretations[0];assert.equal(row.reviews.length,2);assert.equal(row.review_status,'REJECTED');assert.equal(retrieveKnowledge(root).items.length,0);
});
test('changed fact invalidates accepted interpretation without rewriting history',t=>{
  const root=fixture(t);writeKnowledgeCandidate(root,input);reviewKnowledge(root,input.id,'ACCEPTED',human,'Simulation');
  fs.writeFileSync(path.join(root,'docs/proof.md'),'changed fact');const row=listKnowledge(root).interpretations[0];
  assert.equal(row.state,'STALE');assert.equal(row.review_status,'ACCEPTED');assert.equal(retrieveKnowledge(root).items.length,0);
  assert.throws(()=>reviewKnowledge(root,input.id,'ACCEPTED',human,'Cannot reaccept stale'));
});
test('cross-project copied store is quarantined',t=>{
  const a=fixture(t),b=fixture(t);writeKnowledgeCandidate(a,input);fs.mkdirSync(path.join(b,'.agent-os/knowledge'),{recursive:true});
  fs.copyFileSync(path.join(a,'.agent-os/knowledge/records.json'),path.join(b,'.agent-os/knowledge/records.json'));
  assert.equal(listKnowledge(b).interpretations[0].state,'QUARANTINED');assert.equal(retrieveKnowledge(b).items.length,0);
});
test('malformed provenance, missing evidence and duplicate IDs fail',t=>{
  const root=fixture(t);for(const x of [{source:''},{source_kind:'trusted'},{evidence_refs:['missing.md']},{confidence:2},{id:'../x'},{lineage:{evidence_id:'forged'}}]) assert.throws(()=>writeKnowledgeCandidate(root,{...input,...x}));
  writeKnowledgeCandidate(root,input);assert.throws(()=>writeKnowledgeCandidate(root,input));
});
test('transcript, code blob, credential-like and binary payload guardrails',t=>{
  const root=fixture(t);for(const text of ['x'.repeat(4001),'user: hello\nassistant: hello','```js\ncode\n```','password = placeholder-value','a\x00b','<think>private reasoning'])assert.throws(()=>writeKnowledgeCandidate(root,{...input,text}));
});
test('retrieval count/bytes/relevance and omissions are explicit',t=>{
  const root=fixture(t);for(let i=0;i<3;i++){const id=`k-${i}`;writeKnowledgeCandidate(root,{...input,id});reviewKnowledge(root,id,'ACCEPTED',human,'Simulation');}
  assert.equal(retrieveKnowledge(root,{max_count:1}).items.length,1);assert.equal(retrieveKnowledge(root,{max_count:1}).truncated,true);
  assert.equal(retrieveKnowledge(root,{max_bytes:0}).items.length,0);assert.equal(retrieveKnowledge(root,{max_bytes:0}).bytes,0);
  assert.equal(retrieveKnowledge(root,{capability_id:'unrelated'}).items.length,0);
  assert.equal(retrieveKnowledge(root,{paths:['docs/proof.md']}).items.length,3);
  assert.throws(()=>retrieveKnowledge(root,{paths:['../outside']}));assert.throws(()=>retrieveKnowledge(root,{max_count:99}));
});
test('unsafe stores and symlink evidence fail closed',t=>{
  const root=fixture(t),outside=fixture(t);fs.mkdirSync(path.join(root,'.agent-os'),{recursive:true});
  fs.symlinkSync(outside,path.join(root,'.agent-os/knowledge'),'junction');assert.throws(()=>writeKnowledgeCandidate(root,input));
});
test('inert candidate supports all source kinds, discovered never registered',t=>{
  const root=fixture(t);for(const source_kind of SOURCE_KINDS){const r=discoverCandidate(root,{...candidate,source_kind,candidate_id:source_kind});assert.equal(r.status,'DISCOVERED');assert.equal(r.executable,false);}
  assert.equal(listDiscovery(root).length,7);assert.throws(()=>discoverCandidate(root,{...candidate,candidate_id:'API'}));
});
test('candidate assessment distinguishes unknown/rejected/stale/eligible',()=>{
  assert.equal(assessDiscoveryCandidate(candidate).status,'ELIGIBLE');
  assert.equal(assessDiscoveryCandidate({...candidate,license:null}).status,'UNKNOWN');
  assert.equal(assessDiscoveryCandidate({...candidate,license:'FSL-1.1-MIT'}).status,'REJECTED');
  assert.equal(assessDiscoveryCandidate(candidate,{now:Date.parse('2100-01-01')}).status,'STALE');
  const r=assessDiscoveryCandidate(candidate);for(const key of ['registered','available','executable','policy_approved'])assert.equal(r[key],false);
});
test('candidate metadata cannot supply executable fields or executable URLs',()=>{
  for(const patch of [{candidate_id:'../bad'},{url:'javascript:alert(1)'},{url:'file:///tmp/x'},{url:'https://user:pass@example.org'},
    {command:'echo owned'},{import:'module.mjs'},{installed:true},{policy_approved:true},{source_kind:'OSS_DERIVED'},{requirements:{network:false,docker:false,external_runtime:false,command:'x'}}])assert.throws(()=>normalizeCandidate({...candidate,...patch}));
});
test('candidate copied workspace rejected and normalization does not register resolver choice',t=>{
  const a=fixture(t),b=fixture(t);discoverCandidate(a,candidate);fs.mkdirSync(path.join(b,'.agent-os/discovery'),{recursive:true});
  fs.copyFileSync(path.join(a,'.agent-os/discovery/candidates.json'),path.join(b,'.agent-os/discovery/candidates.json'));assert.throws(()=>listDiscovery(b));
  const source=fs.readFileSync(new URL('../intelligence/capability/discovery.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/import\s*\(|execSync|spawn\(|fetch\(|registerImplementation\(/);
});
test('status useful text, current PI, choices and no write',t=>{
  const root=fixture(t),s=projectStatus({project_dir:root,host_id:'codex'});assert.equal(s.ok,true);assert.equal(s.pi.freshness,'COLLECTED_NOW');
  assert.match(formatProductResult(s),/Project:.*\nHost:/);assert.equal(fs.existsSync(path.join(root,'docs/project/tasks')),false);
  assert.ok(['AMBIGUOUS_NEXT_ACTION','READY','NO_ACTIONABLE_TASK'].includes(nextProjectAction({project_dir:root,host_id:'codex'}).status));
});
test('next narrows scope and produces interactive handoff, never writes target',t=>{
  const root=fixture(t),r=nextProjectAction({project_dir:root,host_id:'codex',capability_id:'documentation-sync',prepare:true,path:'docs/proof.md'});
  assert.equal(r.status,'INTERACTIVE_REQUIRED');assert.deepEqual(r.handoff.task_scope.allowed_paths,['docs/proof.md']);
  assert.equal(fs.readFileSync(path.join(root,'docs/proof.md'),'utf8'),'# Evidence\n');assert.equal(r.knowledge.items.length,0);
  assert.equal(nextProjectAction({project_dir:root,host_id:'cursor',capability_id:'documentation-sync',prepare:true}).status,'STALE');
});
function verifiedFixture(t) {
  const root=fixture(t);const c=createTaskCandidate({project_dir:root,task_id:'stage26-task',capability_id:'documentation-sync',objective:'Update scoped documentation',allowed_paths:['docs/proof.md'],verification_strategy:'presence',verification_presence:['docs/proof.md'],agent_id:'docs-sync'}).candidate;
  assert.equal(createHostHandoff({project_dir:root,candidate:c,host_id:'codex',persist:true}).ok,true);return root;
}
test('full completion verifies evidence/Canvas then writes UNREVIEWED candidate with lineage',t=>{
  const root=verifiedFixture(t);fs.appendFileSync(path.join(root,'docs/proof.md'),'\nScoped action by test host.\n');
  const r=completeProjectTask({project_dir:root,host_id:'codex',task_id:'stage26-task',changed_paths:['docs/proof.md'],learning:'Presence checks prove file existence, not semantic quality.'});
  assert.equal(r.verification_status,'PASS');assert.equal(r.status,'KNOWLEDGE_REVIEW_REQUIRED');assert.equal(r.knowledge.candidate.lineage.evidence_id,r.evidence.evidence_id);
  assert.equal(r.knowledge.candidate.review_status,'UNREVIEWED');assert.ok(r.canvas_after);assert.equal(retrieveKnowledge(root).items.length,0);
  const store=JSON.parse(fs.readFileSync(path.join(root,'.agent-os/knowledge/records.json'),'utf8'));store[0].lineage.evidence_id='0'.repeat(24);
  fs.writeFileSync(path.join(root,'.agent-os/knowledge/records.json'),JSON.stringify(store));assert.equal(listKnowledge(root).interpretations[0].state,'INVALID');
});
test('workflow refuses Policy deny, changed path escape, host replay, task substitution',t=>{
  const root=verifiedFixture(t),opts={project_dir:root,host_id:'codex',task_id:'stage26-task'};
  assert.equal(completeProjectTask({...opts,policy_decision:'deny'}).status,'POLICY_DENIED');
  assert.equal(completeProjectTask({...opts,changed_paths:['src/a.js']}).status,'POLICY_DENIED');
  assert.equal(completeProjectTask({...opts,host_id:'cursor'}).ok,false);assert.equal(completeProjectTask({...opts,task_id:'other-task'}).ok,false);
});
test('missing evidence produces failure and cannot write knowledge',t=>{
  const root=verifiedFixture(t);fs.unlinkSync(path.join(root,'docs/proof.md'));
  const r=completeProjectTask({project_dir:root,host_id:'codex',task_id:'stage26-task',learning:'Should not store'});assert.equal(r.status,'VERIFICATION_FAILED');assert.equal(listKnowledge(root).interpretations.length,0);
});
test('CLI validates flags and supports knowledge review without manual JSON',t=>{
  const root=fixture(t),base=['--project',root];assert.equal(runProductCli(['status','--bad']).ok,false);assert.equal(runProductCli(['status','--host']).ok,false);
  const r=runProductCli(['knowledge','add',...base,'--id','cli-note','--text','Compact CLI observation','--source','codex','--evidence','docs/proof.md']);assert.equal(r.ok,true);
  assert.equal(runProductCli(['knowledge','accept',...base,'--id','cli-note','--reviewer','operator','--note','Simulation']).ok,false);
  assert.equal(runProductCli(['knowledge','accept',...base,'--id','cli-note','--reviewer','operator','--confirm-human','--note','Controlled operator simulation']).ok,true);
  assert.equal(runProductCli(['knowledge','recall',...base]).items.length,1);
});
test('accepted review is bound to candidate content and cannot bless later edits',t=>{
  const root=fixture(t);writeKnowledgeCandidate(root,input);reviewKnowledge(root,input.id,'ACCEPTED',human,'Simulation');
  const file=path.join(root,'.agent-os/knowledge/records.json'),rows=JSON.parse(fs.readFileSync(file,'utf8'));
  rows[0].text='Changed after acceptance';fs.writeFileSync(file,JSON.stringify(rows));
  assert.equal(listKnowledge(root).interpretations[0].state,'INVALID');assert.equal(retrieveKnowledge(root).items.length,0);
});
test('agents may explicitly reject own candidates but never accept them',t=>{
  const root=fixture(t);writeKnowledgeCandidate(root,input);
  reviewKnowledge(root,input.id,'REJECTED',{kind:'agent',id:'codex',confirmed:true},'Explicit self rejection, not user confirmation');
  assert.equal(listKnowledge(root).interpretations[0].review_status,'REJECTED');
  assert.throws(()=>reviewKnowledge(root,input.id,'ACCEPTED',{kind:'agent',id:'other-agent',confirmed:true},'Forbidden'));
});
test('malformed, oversized, duplicate stores and occupied writer lock fail closed',t=>{
  const root=fixture(t);writeKnowledgeCandidate(root,input);const file=path.join(root,'.agent-os/knowledge/records.json');
  const before=fs.readFileSync(file,'utf8');fs.writeFileSync(file+'.lock','existing writer');
  assert.throws(()=>writeKnowledgeCandidate(root,{...input,id:'second'}));assert.equal(fs.readFileSync(file,'utf8'),before);fs.unlinkSync(file+'.lock');
  fs.writeFileSync(file,'{bad');assert.throws(()=>listKnowledge(root));
  fs.writeFileSync(file,'x'.repeat(1048577));assert.throws(()=>listKnowledge(root));
  fs.writeFileSync(file,JSON.stringify([...JSON.parse(before),...JSON.parse(before)]));assert.throws(()=>listKnowledge(root));
});
test('old verification cannot bind a new current candidate after checked source changes',t=>{
  const root=verifiedFixture(t);const r=completeProjectTask({project_dir:root,host_id:'codex',task_id:'stage26-task',changed_paths:['docs/proof.md'],learning:'Initial candidate'});
  assert.equal(r.knowledge.ok,true);fs.writeFileSync(path.join(root,'docs/proof.md'),'new checked source');
  assert.throws(()=>writeKnowledgeCandidate(root,{...input,id:'forged-fresh',lineage:r.knowledge.candidate.lineage}));
});
test('scope/operation substitution and corrupt handoff cannot complete',t=>{
  const root=verifiedFixture(t),file=path.join(root,'docs/project/tasks/stage26-task.handoff.json');
  const handoff=JSON.parse(fs.readFileSync(file,'utf8'));handoff.operation_id='substituted';fs.writeFileSync(file,JSON.stringify(handoff));
  assert.equal(completeProjectTask({project_dir:root,host_id:'codex',task_id:'stage26-task'}).ok,false);
});
test('task-specific Policy keeps protected path deny and does not persist session or leak project env',t=>{
  const root=fixture(t),previous=process.env.CURSOR_PROJECT_DIR;
  const c=createTaskCandidate({project_dir:root,task_id:'policy-task',capability_id:'documentation-sync',agent_id:'docs-sync',allowed_paths:['docs/**','policy/**'],forbidden_paths:[]}).candidate;
  assert.equal(evaluateScopedTaskTool(c,root,{tool_name:'Write',tool_input:{path:'docs/proof.md'}}).permission,'allow');
  assert.equal(evaluateScopedTaskTool(c,root,{tool_name:'Write',tool_input:{path:'policy/rules.json'}}).permission,'deny');
  assert.equal(process.env.CURSOR_PROJECT_DIR,previous);assert.equal(fs.existsSync(path.join(root,'.cursor/policy/runtime-session.json')),false);
});
test('next reports supplied DENY and refuses outside narrowed path',t=>{
  const root=fixture(t);assert.equal(nextProjectAction({project_dir:root,policy_decision:'deny'}).status,'POLICY_DENIED');
  assert.equal(nextProjectAction({project_dir:root,host_id:'codex',capability_id:'documentation-sync',prepare:true,path:'../outside'}).status,'POLICY_DENIED');
});
test('release portability exemption is limited to validated local handoff workspace fields',t=>{
  const root=verifiedFixture(t),rel='docs/project/tasks/stage26-task.handoff.json';
  const raw=fs.readFileSync(path.join(root,rel),'utf8'),record=JSON.parse(raw),workspace=record.workspace.project_dir;
  assert.equal(portabilityScanText(root,rel,raw).includes(workspace),false);
  assert.equal(portabilityScanText(root,'intelligence/example.mjs',raw),raw);
  record.instructions += workspace;record.integrity=computeHandoffIntegrity(record);
  assert.equal(portabilityScanText(root,rel,JSON.stringify(record)).includes(workspace),true);
  record.integrity='broken';assert.equal(portabilityScanText(root,rel,JSON.stringify(record)),JSON.stringify(record));
});
test('native write/delete aliases cannot escape read-only action classes',t=>{
  const root=fixture(t),c=createTaskCandidate({project_dir:root,task_id:'read-task',capability_id:'documentation-sync',agent_id:'docs-sync',allowed_paths:['docs/**'],permitted_action_classes:['read','analyze']}).candidate;
  for(const tool_name of ['Write','ApplyPatch','StrReplace','Delete'])assert.equal(evaluateScopedTaskTool(c,root,{tool_name,tool_input:{path:'docs/proof.md'}}).permission,'deny');
});
