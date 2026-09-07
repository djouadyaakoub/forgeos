import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createTaskScope } from '../policy/task-scope.mjs';
import { previewExactApproval, issueExactApproval, validateExactApproval, consumeExactApproval,
  revokeExactApproval, canonicalApprovalTime, normalizeExactEvent } from '../policy/exact-approval.mjs';
import { evaluateShell, dispatchExactShell, evaluatePreToolUse } from '../policy/authority.mjs';
import { getTasksBasePath, loadRules } from '../policy/engine.mjs';
import { executeGoverned, clearExecutionGuards } from '../runtime/execution.mjs';
import { createLocalExecutorBackend } from '../runtime/adapters/local-executor.mjs';
import { createOpenHandsBackend } from '../runtime/adapters/openhands/index.mjs';
import { createRuntimeRegistry } from '../runtime/registry.mjs';
import { createRunRequest } from '../runtime/backend-interface.mjs';
import { createHostCapabilityDescriptor } from '../host/adapter.mjs';
import { runExactApprovalCli } from '../cli/approve.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'forgeos-s30-'));
  const previous = process.env.CURSOR_PROJECT_DIR; process.env.CURSOR_PROJECT_DIR = root;
  t.after(()=>{ if(previous===undefined)delete process.env.CURSOR_PROJECT_DIR;else process.env.CURSOR_PROJECT_DIR=previous;
    assert.equal(path.dirname(root),path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('forgeos-s30-'));
    fs.rmSync(root,{recursive:true,force:true}); clearExecutionGuards(); });
  const dir = path.join(root,getTasksBasePath(loadRules()),'active','S30'); fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'task.yaml'),'approval:\n  required: true\n  status: approved\n  scope:\n    - git_push\n    - git_force_push\n');
  const input = {project_dir:root,task_id:'S30',capability_id:'release-readiness',operation_id:'push-origin',
    action:'git_push',agent_id:'release-deployment',execution_id:'execution-1',
    event:{tool_name:'Shell',tool_input:{command:'git push origin main'}}};
  input.task_scope = createTaskScope({...input,allowed_paths:['**'],permitted_action_classes:['read','execute']}).scope;
  assert.ok(input.task_scope);
  const issued = issueExactApproval({...input,confirmed:true,confirmation_fingerprint:previewExactApproval(input).binding_fingerprint,
    approved_by:'operator',expires_at:new Date(Date.now()+600000).toISOString()});
  input.approval_id=issued.approval.approval_id;
  return {root,input,dir,issued};
}
const event = command => ({tool_name:'Shell',tool_input:{command}});
test('same normalized subject validates repeatedly; authoritative dispatch consumes exactly once',t=>{
  const {input}=fixture(t); const session={task_id:'S30',subagent_type:'release-deployment'};
  for(let i=0;i<2;i++)assert.equal(evaluateShell('git push origin main',session,input).permission,'allow');
  let effects=0; const first=dispatchExactShell(input,argv=>{effects++;assert.deepEqual([...argv],['git','push','origin','main']);return 0;});
  assert.equal(first.ok,true,JSON.stringify(first)); assert.equal(first.receipt.verification,'NOT_ESTABLISHED');
  assert.equal(validateExactApproval(input).reason,'DENY_REPLAY');
  assert.equal(dispatchExactShell(input,()=>effects++).ok,false);assert.equal(effects,1);
});
test('changed target, branch, force, task, capability, operation, workspace and scope reject',t=>{
  const {input}=fixture(t);
  for(const command of ['git push upstream main','git push origin other','git push --force origin main'])
    assert.equal(validateExactApproval({...input,event:event(command)}).ok,false,command);
  for(const key of ['task_id','capability_id','operation_id'])assert.equal(validateExactApproval({...input,[key]:'other'}).ok,false,key);
  assert.equal(validateExactApproval({...input,project_dir:os.tmpdir()}).ok,false);
  const changed=createTaskScope({...input,allowed_paths:['docs/**'],permitted_action_classes:['execute']}).scope;
  assert.equal(validateExactApproval({...input,task_scope:changed}).ok,false);
  assert.equal(validateExactApproval({...input,task_scope:{...input.task_scope,allowed_paths:['other/**']}}).ok,false);
});
test('structured host wrappers normalize equivalently without stripping semantic arguments',t=>{
  const {input,root}=fixture(t), expected=previewExactApproval(input).binding_fingerprint;
  for(const e of [{tool_name:'Bash',tool_input:{command:'git  push origin main'}},
    {tool_name:'exec_command',tool_input:{argv:['git','push','origin','main'],cwd:root}},
    {tool_name:'exec_command',tool_input:{cmd:'git push origin main'}}])
    assert.equal(previewExactApproval({...input,event:e}).binding_fingerprint,expected);
  for(const command of ['git\tpush origin main','git push origin main; echo x','git push "origin" main','git push origin $(x)','git push origin mаin'])
    assert.throws(()=>normalizeExactEvent(event(command),root));
  assert.throws(()=>normalizeExactEvent({tool_name:'Shell',tool_input:{command:'git push origin main',cmd:'git push other main'}},root));
  const sparse=[];sparse.length=3;assert.throws(()=>normalizeExactEvent({tool_name:'Shell',tool_input:{argv:sparse}},root));
  assert.throws(()=>normalizeExactEvent({tool_name:'Shell',get tool_input(){throw Error('getter');}},root));
});
test('canonical expiry rejects malformed, impossible, offset, expired and future records',t=>{
  const {input,issued,root}=fixture(t);
  for(const s of ['invalid','2026-02-30T00:00:00.000Z','2026-01-01T00:00:00Z','2026-01-01T01:00:00.000+01:00'])
    assert.throws(()=>canonicalApprovalTime(s));
  assert.throws(()=>issueExactApproval({...input,confirmed:true,confirmation_fingerprint:previewExactApproval(input).binding_fingerprint,
    approved_by:'operator',expires_at:new Date(Date.now()-1).toISOString()}));
  const file=path.join(root,'.agent-os/approvals',input.approval_id+'.json');
  fs.writeFileSync(file,JSON.stringify({...issued.approval,expires_at:'invalid'}));assert.equal(validateExactApproval(input).ok,false);
});
test('Policy DENY and missing exact evidence cannot be overridden; failed precheck stays unconsumed',t=>{
  const {input,dir}=fixture(t);let effects=0;
  assert.equal(evaluateShell('git push origin main',{task_id:'S30',subagent_type:'release-deployment'}).permission,'deny');
  assert.equal(dispatchExactShell({...input,event:event('git push upstream main')},()=>effects++).ok,false);
  assert.equal(validateExactApproval(input).ok,true);
  fs.writeFileSync(path.join(dir,'task.yaml'),'approval:\n  status: rejected\n');
  assert.equal(dispatchExactShell(input,()=>effects++).ok,false);assert.equal(effects,0);
  assert.equal(validateExactApproval(input).ok,true);
});
test('post-dispatch exception, partial receipt, stale lock and revocation never reopen approval',t=>{
  const a=fixture(t);const r=dispatchExactShell(a.input,()=>{throw Error('unknown effect');});
  assert.equal(r.reason,'EXECUTION_OUTCOME_UNKNOWN_REAPPROVAL_REQUIRED');assert.equal(validateExactApproval(a.input).reason,'DENY_REPLAY');
  for(const suffix of ['consumed','lock']){
    const b=fixture(t);fs.writeFileSync(path.join(b.root,'.agent-os/approvals',b.input.approval_id+'.'+suffix),'{');
    assert.equal(consumeExactApproval(b.input).ok,false);
  }
  const c=fixture(t);revokeExactApproval(c.root,c.input.approval_id);assert.equal(consumeExactApproval(c.input).reason,'approval_revoked');
});
test('parallel processes produce exactly one durable consumer',async t=>{
  const {input}=fixture(t),moduleUrl=new URL('../policy/exact-approval.mjs',import.meta.url).href;
  const code=`import {consumeExactApproval} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(consumeExactApproval(JSON.parse(process.argv[1]))));`;
  const outputs=await Promise.all(Array.from({length:8},()=>new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,['--input-type=module','-e',code,JSON.stringify(input)],{stdio:['ignore','pipe','pipe']});let out='',err='';
    p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);
    p.on('close',c=>c?reject(Error(err)):resolve(JSON.parse(out)));
  })));
  assert.equal(outputs.filter(x=>x.ok).length,1);assert.equal(validateExactApproval(input).reason,'DENY_REPLAY');
});
test('Local Executor mock dispatch enforces even direct backend calls and exposes receipt',t=>{
  const {input,root}=fixture(t);let effects=0;
  const backend=createLocalExecutorBackend({exactCommandRunner:()=>{effects++;return {exit_code:0,stdout:'mock',stderr:''};}});
  const request=createRunRequest({task_id:input.task_id,policy_decision:{authority:'forgeos',decision:'allow'},
    verification_commands:[],execution_constraints:{project_dir:root,operation:'run_commands',commands:['git push origin main'],exact_approval:input}});
  const first=backend.start(request);assert.equal(first.kind,'started',JSON.stringify(first));assert.equal(first.approval_receipts.length,1);
  assert.notEqual(backend.start(request).kind,'started');assert.equal(effects,1);
});
test('governed execution ignores forged ALLOW for high risk and preserves dry-run approval',t=>{
  const {input,root}=fixture(t);let effects=0;const registry=createRuntimeRegistry();
  registry.register(createLocalExecutorBackend({exactCommandRunner:()=>{effects++;return {exit_code:0,stdout:'',stderr:''};}}));
  const req={...input,project_dir:root,operation:{type:'run_commands',commands:['git push origin main']},
    backend_id:'local-executor',registry,exact_approval_id:input.approval_id,verification_commands:[],evaluate_policy:false,
    policy_decision:{authority:'forgeos',decision:'allow'}};
  assert.equal(executeGoverned({...req,exact_approval_id:'missing'}).status,'POLICY_DENIED');
  const preview=executeGoverned({...req,dry_run:true});assert.equal(preview.status,'DRY_RUN',JSON.stringify(preview));
  assert.equal(validateExactApproval(input).ok,true);assert.equal(effects,0);
  const first=executeGoverned(req);assert.equal(first.status,'COMPLETED',JSON.stringify(first));assert.equal(effects,1);
  assert.notEqual(executeGoverned({...req,execution_id:'retry'}).status,'COMPLETED');assert.equal(effects,1);
});
test('verification and batched high-risk commands fail closed before any effect',t=>{
  const {input,root}=fixture(t);let effects=0;const backend=createLocalExecutorBackend({exactCommandRunner:()=>effects++});
  for(const verification of [true,false]){
    const request=createRunRequest({task_id:'S30',policy_decision:{authority:'forgeos',decision:'allow'},
      verification_commands:verification?['git push origin main']:[],execution_constraints:{project_dir:root,
        operation:'run_commands',commands:verification?['git push origin main']:['git push origin main','git push origin other'],exact_approval:input}});
    assert.notEqual(backend.start(request).kind,'started');
  }
  assert.equal(effects,0);assert.equal(validateExactApproval(input).ok,true);
});
test('hosts share truthful metadata; intercepted Tier3 is denied, ordinary read stays ordinary',t=>{
  const {input}=fixture(t);
  for(const host_id of ['codex','cursor','claude-code']){
    const d=createHostCapabilityDescriptor({host_id,invocation:'interactive'});
    assert.equal(d.exact_approval.interactive,'DECLARED_ONLY');assert.equal(d.exact_approval.hooked_tool,'UNSUPPORTED');
    assert.equal(evaluatePreToolUse({...event('git push origin main'),host_id}).permission,'deny');
    assert.equal(evaluatePreToolUse({tool_name:'Read',tool_input:{path:'README.md'},host_id}).permission,'allow');
  }
  assert.equal(validateExactApproval(input).ok,true);
});
test('CLI preview displays subject, confirmation is exact and preview creates no approval',t=>{
  const {input,root}=fixture(t);const p=path.join(root,'intent.json');
  const {task_id,capability_id,operation_id,task_scope,event:e}=input;
  fs.writeFileSync(p,JSON.stringify({task_id,capability_id,operation_id,task_scope,event:e}));
  const args=['--project',root,'--file','intent.json','--expires-at',new Date(Date.now()+600000).toISOString()];
  const before=fs.readdirSync(path.join(root,'.agent-os/approvals'));
  const preview=runExactApprovalCli(args);assert.equal(preview.ok,true,JSON.stringify(preview));assert.ok(preview.preview.target.includes('origin'));
  assert.deepEqual(fs.readdirSync(path.join(root,'.agent-os/approvals')),before);
  assert.equal(runExactApprovalCli([...args,'--confirm-human','--by','operator','--confirm-fingerprint','wrong']).ok,false);
  assert.equal(runExactApprovalCli([...args,'--confirm-human','--by','operator','--confirm-fingerprint',preview.preview.binding_fingerprint]).ok,true);
});

test('alternate Git invocation cannot fall through as a low-risk command',t=>{
  const {input}=fixture(t);
  for(const command of ['git -C . push origin main','git.exe push origin main',"'git' 'push' origin main",'git push origin main && echo done']){
    assert.equal(evaluateShell(command,{task_id:'S30',subagent_type:'release-deployment'},input).permission,'deny',command);
  }
});
test('validly recorded expired/future approvals and stale project scope reject',t=>{
  const {input,root}=fixture(t), now=Date.now();
  for(const [issued,expires] of [[now-120000,now-60000],[now+60000,now+120000]]){
    const r=issueExactApproval({...input,confirmed:true,confirmation_fingerprint:previewExactApproval(input).binding_fingerprint,
      approved_by:'operator',issued_at:new Date(issued).toISOString(),expires_at:new Date(expires).toISOString()});
    assert.equal(validateExactApproval({...input,approval_id:r.approval.approval_id}).reason,'approval_expired_or_invalid');
  }
  fs.mkdirSync(path.join(root,'.agent-os'),{recursive:true});
  fs.writeFileSync(path.join(root,'.agent-os/project.yaml'),'contract:\n  version: 1\nproject:\n  id: changed\n');
  assert.equal(validateExactApproval(input).ok,false);
});
test('approval store rejects symlink/junction escape',t=>{
  const a=fixture(t),b=fixture(t), store=path.join(a.root,'.agent-os/approvals');
  // Move only this temporary fixture store, then replace it with an outside junction.
  fs.renameSync(store,store+'-original');fs.symlinkSync(path.join(b.root,'.agent-os/approvals'),store,process.platform==='win32'?'junction':'dir');
  assert.equal(validateExactApproval(a.input).ok,false);assert.equal(consumeExactApproval(a.input).ok,false);
});

test('unsupported external direct backend dispatch blocks before transport or health',t=>{
  const {input,root}=fixture(t); const backend=createOpenHandsBackend({transport:'probe'});
  backend.health=()=>{throw Error('must not contact transport');};
  for(const verification of [false,true]){
    const request=createRunRequest({task_id:'S30',policy_decision:{authority:'forgeos',decision:'allow'},
      verification_commands:verification?['git push origin main']:[],execution_constraints:{project_dir:root,
        operation:'run_commands',commands:verification?[]:['git push origin main'],exact_approval:input}});
    assert.equal(backend.start(request).policy_decision.reason,'tier3_backend_dispatch_unsupported');
  }
  assert.equal(validateExactApproval(input).ok,true);
});
