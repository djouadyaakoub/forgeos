import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProductCli } from '../cli/forgeos.mjs';
import { projectStatus, nextProjectAction, completeProjectTask } from '../intelligence/orchestrator/product-workflow.mjs';
import { selectWorkflow } from '../intelligence/orchestrator/workflow-profile.mjs';
import { inspectContext, benchmarkContext } from '../intelligence/orchestrator/context-diagnostic.mjs';
import { createDocumentationContract, verifyDocumentationContract } from '../intelligence/orchestrator/documentation-verification.mjs';
import { createTaskCandidate } from '../intelligence/assessment/task-candidate.mjs';
import { createHostHandoff } from '../intelligence/orchestrator/host-handoff.mjs';
import { assessCapabilityVerification } from '../intelligence/orchestrator/capability-verification.mjs';
import { writeKnowledgeCandidate, reviewKnowledge, retrieveKnowledge } from '../intelligence/assessment/knowledge-lifecycle.mjs';
function fixture(t, host='codex') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'forgeos-s27-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'docs'));fs.mkdirSync(path.join(root,'src'));
  fs.writeFileSync(path.join(root,'package.json'),'{"name":"fixture","type":"module"}');
  fs.writeFileSync(path.join(root,'src/a.js'),'export const a = 1;\n');
  fs.writeFileSync(path.join(root,'README.md'),'# Fixture\nNode project\n');
  assert.equal(runProductCli(['init','--project',root,'--host',host,'--apply']).ok,true);
  return root;
}
test('legacy AGENTS presence PASS cannot discharge missing STACK finding',t=>{
  const root=fixture(t);
  const c=createTaskCandidate({project_dir:root,task_id:'legacy',capability_id:'documentation-sync',agent_id:'docs-sync',allowed_paths:['AGENTS.md'],verification_strategy:'presence',verification_presence:['AGENTS.md']}).candidate;
  assert.equal(createHostHandoff({project_dir:root,candidate:c,host_id:'codex',persist:true}).ok,true);
  const r=completeProjectTask({project_dir:root,task_id:'legacy',host_id:'codex'});
  assert.equal(r.verification_status,'PASS');assert.equal(r.capability_satisfied,false);
  assert.notEqual(r.canvas_after.task_capability.state,'SATISFIED');
});
for(const host of ['codex','cursor','claude-code']) test(`semantic lifecycle ${host}: unresolved, equivalent, fixed, stale`,t=>{
  const root=fixture(t,host);
  const h=nextProjectAction({project_dir:root,host_id:host,capability_id:'documentation-sync',path:'docs/STACK.md',prepare:true});
  assert.equal(h.status,'INTERACTIVE_REQUIRED',JSON.stringify(h));
  assert.equal(h.handoff.verification_strategy,'finding_resolution');
  const complete=()=>completeProjectTask({project_dir:root,host_id:host,task_id:h.handoff.task_id,changed_paths:['docs/STACK.md']});
  assert.equal(complete().verification_status,'FAIL');
  fs.writeFileSync(path.join(root,'docs/STACK.md'),'# Incorrect stack\nPython only\n');
  assert.equal(complete().verification_status,'FAIL');
  fs.writeFileSync(path.join(root,'docs/STACK.md'),'# Stack\nNode.js ESM\n');
  const done=complete();assert.equal(done.verification_status,'PASS');assert.equal(done.capability_satisfied,true,JSON.stringify(done.canvas_after));
  fs.writeFileSync(path.join(root,'docs/STACK.md'),'');
  assert.equal(projectStatus({project_dir:root,host_id:host}).canvas.satisfied,0);
});
test('scoped finding PASS may coexist with unrelated README finding',t=>{
  const root=fixture(t);fs.unlinkSync(path.join(root,'README.md'));
  const h=nextProjectAction({project_dir:root,host_id:'codex',capability_id:'documentation-sync',path:'docs/STACK.md',prepare:true});
  fs.writeFileSync(path.join(root,'docs/STACK.md'),'Node.js');
  const r=completeProjectTask({project_dir:root,host_id:'codex',task_id:h.handoff.task_id,changed_paths:['docs/STACK.md']});
  assert.equal(r.verification_status,'PASS');assert.equal(r.capability_satisfied,false);
});
test('contracts reject configuration/task/workspace substitution and downgrade',t=>{
  const root=fixture(t), c={task_id:'t',capability_id:'documentation-sync',verification_strategy:'finding_resolution'};
  c.verification_contract=createDocumentationContract(root,'t',c.capability_id,'docs/STACK.md');
  assert.equal(verifyDocumentationContract(root,{...c,task_id:'other'})[0].result,'UNKNOWN');
  assert.equal(verifyDocumentationContract(fixture(t),c)[0].result,'UNKNOWN');
  fs.appendFileSync(path.join(root,'.agent-os/project.yaml'),'\n# configuration change\n');
  assert.equal(verifyDocumentationContract(root,c)[0].result,'UNKNOWN');
  const r=assessCapabilityVerification({project_dir:root,candidate:{...c,verification_strategy:'presence',verification_presence:['AGENTS.md']},governed:{status:'COMPLETED'}});
  assert.equal(r.result,'FAIL');
});
test('presence is regular-file bounded, no parent/drive/symlink acceptance',t=>{
  const root=fixture(t);
  for(const p of ['docs','../outside','C:\\outside','/etc/passwd']) {
    const r=assessCapabilityVerification({project_dir:root,candidate:{verification_strategy:'presence',verification_presence:[p]},governed:{status:'COMPLETED'}});
    assert.equal(r.result,'FAIL');
  }
});
test('workflow floors are deterministic and never downgrade risk',()=>{
  assert.equal(selectWorkflow({action:'read',risk:'low',paths:['docs/a.md']}).profile,'MINIMAL');
  assert.equal(selectWorkflow({action:'write',risk:'medium',paths:['src/a.js','src/b.js']}).profile,'SCOPED');
  for(const signal of [{risk:'high'},{risk:null},{paths:['policy/a.mjs']},{capability_id:'security-migration'},{cross_domain:true}])
    assert.equal(selectWorkflow({action:'write',risk:'low',paths:['docs/a.md'],requested:'minimal',...signal}).profile,'FULL');
  assert.equal(selectWorkflow({action:'read',risk:'low',paths:['a'],requested:'full'}).profile,'FULL');
  assert.throws(()=>selectWorkflow({requested:'invalid'}));
});
test('minimal and scoped read-only paths really omit full assessment; deny survives',t=>{
  const root=fixture(t);
  const tiny=inspectContext({project_dir:root,path:'README.md'});
  assert.equal(tiny.workflow.profile,'MINIMAL');assert.equal(tiny.context.assessment,null);assert.equal(tiny.context.knowledge,null);
  const scoped=inspectContext({project_dir:root,paths:['README.md','src/a.js'],risk:'medium'});
  assert.equal(scoped.workflow.profile,'SCOPED');assert.equal(scoped.context.assessment,null);
  assert.throws(()=>inspectContext({project_dir:root,path:'README.md',policy_decision:'deny'}));
  assert.throws(()=>inspectContext({project_dir:root,path:'.env'}));
});
test('request-local elimination does not reuse facts across commands, projects or mutations',t=>{
  const a=fixture(t), b=fixture(t), first=projectStatus({project_dir:a,host_id:'codex'});
  assert.equal(projectStatus({project_dir:a,host_id:'codex'}).pi.fingerprint,first.pi.fingerprint);
  assert.notEqual(projectStatus({project_dir:b,host_id:'codex'}).pi.fingerprint,first.pi.fingerprint);
  fs.writeFileSync(path.join(a,'src/a.js'),'export const a = 2;\n');
  assert.notEqual(projectStatus({project_dir:a,host_id:'codex'}).pi.fingerprint,first.pi.fingerprint);
});
test('context benchmark measures overhead honestly; accepted knowledge remains shared and bounded',t=>{
  const root=fixture(t), options={project_dir:root,paths:['README.md','src/a.js'],host_id:'codex'};
  const without=benchmarkContext(options);
  assert.equal(without.real_token_usage,'REAL_TOKEN_USAGE_UNAVAILABLE');assert.equal(without.results.length,8);
  assert.ok(without.results[0].context_reduction_ratio<0);
  writeKnowledgeCandidate(root,{id:'lesson',text:'The fixture exports one constant.',source:'fixture-agent',evidence_refs:['src/a.js']});
  reviewKnowledge(root,'lesson','ACCEPTED',{kind:'human',id:'simulated-operator',confirmed:true},'Controlled test simulation only');
  const shared=['codex','cursor','claude-code'].map(host=>inspectContext({...options,host_id:host,risk:'medium'}).context.knowledge.items);
  assert.deepEqual(shared[0],shared[1]);assert.deepEqual(shared[1],shared[2]);assert.equal(shared[0].length,1);
  assert.equal(retrieveKnowledge(root,{max_bytes:0}).items.length,0);
});
test('init preview, idempotency, existing instructions, unsupported language and malformed host',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'forgeos-s27-init-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const args=['init','--project',root,'--host','codex'];
  assert.equal(runProductCli(args).ok,true);assert.equal(fs.readdirSync(root).length,0);
  fs.writeFileSync(path.join(root,'AGENTS.md'),'# Preserve exactly');fs.writeFileSync(path.join(root,'main.rs'),'fn main() {}');
  assert.equal(runProductCli([...args,'--apply']).ok,true);assert.equal(runProductCli([...args,'--apply']).actions.length,0);
  assert.equal(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8'),'# Preserve exactly');
  fs.writeFileSync(path.join(root,'.agent-os/project.yaml'),'host: [invalid]\n');
  assert.equal(runProductCli([...args,'--apply']).ok,false);
});
test('bin mapping and public CLI diagnostics',()=>{
  assert.equal(JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).bin.forgeos,'cli/forgeos.mjs');
  const help=runProductCli(['--help']).help;
  for(const name of ['init','host','workflow','benchmark','knowledge','discovery']) assert.ok(help.includes(name));
});
test('controlled six-scenario benchmark with before/after accepted interpretation measurements',t=>{
  const root=fixture(t), paths=['README.md','src/a.js'];
  for(let i=0;i<8;i++) {const p=`docs/context-${i}.md`;paths.push(p);fs.writeFileSync(path.join(root,p),`# Fixture ${i}\n`+'Bounded local evidence. '.repeat(100));}
  const options={project_dir:root,paths,host_id:'codex'};
  const without=benchmarkContext(options);
  writeKnowledgeCandidate(root,{id:'continuity',text:'The README describes the fixture Node entrypoint.',source:'fixture-agent',evidence_refs:['README.md']});
  reviewKnowledge(root,'continuity','ACCEPTED',{kind:'human',id:'simulated-operator',confirmed:true},'Controlled benchmark operator simulation, not project knowledge acceptance');
  const withKnowledge=benchmarkContext(options);
  assert.equal(withKnowledge.results.find(r=>r.scenario==='repeated').retrieval_items,1);
  t.diagnostic(JSON.stringify({benchmark:'controlled_stage27',without:without.results,with_accepted:withKnowledge.results,real_tokens:withKnowledge.real_token_usage}));
});
