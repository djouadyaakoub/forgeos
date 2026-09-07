import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCapabilityBindings } from '../intelligence/capability/binding.mjs';
import { completionSemantics } from '../intelligence/capability/completion.mjs';
import { assessCapabilityVerification } from '../intelligence/orchestrator/capability-verification.mjs';
import { classifyRcPath, deriveRcSourceManifest, SOURCE_ROOT } from '../scripts/release/rc-source-manifest.mjs';
import { copyRcSource } from '../scripts/release/validate-rc-source.mjs';
import { auditProductLeakage, auditProductPaths } from '../scripts/release/product-leakage.mjs';
import { runProductCli, productDiagnostic } from '../cli/forgeos.mjs';
function temp(t) {const p=fs.mkdtempSync(path.join(os.tmpdir(),'forgeos-s28-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
test('primary diagnostics distinguish ten operator outcomes, retaining raw reasons',t=>{
  for(const [reason,code] of [['workspace_missing','INVALID_PROJECT'],['unsupported_host','UNSUPPORTED_HOST'],['policy_deny','POLICY_DENIED'],
    ['scope_path_outside','SCOPE_VIOLATION'],['handoff_missing','STALE_TASK'],['invalid_local_store','MALFORMED_LOCAL_STATE']])
    assert.equal(productDiagnostic({ok:false,reason}),code);
  for(const status of ['VERIFICATION_FAILED','NO_ACTIONABLE_TASK','AMBIGUOUS_NEXT_ACTION','KNOWLEDGE_REVIEW_REQUIRED'])assert.equal(productDiagnostic({status}),status);
  const missing=path.join(temp(t),'missing');
  assert.equal(runProductCli(['status','--project',missing]).diagnostic_code,'INVALID_PROJECT');
  const unsupported=runProductCli(['init','--project',temp(t),'--host','unsupported']);
  assert.equal(unsupported.diagnostic_code,'UNSUPPORTED_HOST',JSON.stringify(unsupported));
});
test('all 37 capabilities have explicit built-in acceptance floors, no invented presence completion',()=>{
  const {capabilities}=loadCapabilityBindings();assert.equal(capabilities.length,37);
  for(const c of capabilities) {
    assert.deepEqual(c.acceptance_semantics,completionSemantics(c.id));
    assert.ok(c.acceptance_semantics.reason.length>20);
    if(c.acceptance_semantics.automatic)assert.ok(['documentation-sync','documentation-drift','health-check','smoke-test'].includes(c.id));
  }
});
for(const id of ['structure-audit','dependency-audit','architecture-guard','artifact-verification','release-readiness','solution-research','deployment-plan'])
  test(`${id}: arbitrary marker cannot prove analysis or completion`,t=>{
    const root=temp(t);fs.writeFileSync(path.join(root,'done.md'),'done');
    const r=assessCapabilityVerification({project_dir:root,candidate:{capability_id:id,verification_strategy:'presence',verification_presence:['done.md']},governed:{status:'COMPLETED'}});
    assert.equal(r.result,'UNKNOWN');assert.ok(r.checks.some(c=>c.reason==='semantic_completion_contract_not_implemented'));
  });
test('manifest keeps runtime closure, excludes local state and histories without deleting them',()=>{
  const m=deriveRcSourceManifest();
  for(const p of ['agents/registry.yaml','cli/forgeos.mjs','package-lock.json','scripts/release/deterministic-zip.mjs'])
    assert.equal(m.files.find(f=>f.path===p)?.decision,'INCLUDE',p);
  for(const p of ['.agent-os/knowledge/x.json','docs/project/tasks/task.json','tests/fixtures/a/docs/project/assessments/x.json','release/checksums.json']) {
    assert.equal(classifyRcPath(p).decision,'EXCLUDE');assert.equal(classifyRcPath(p).required_for_distribution,false);
  }
  assert.equal(classifyRcPath('docs/reports/STAGE-27-report.md').decision,'HUMAN_REVIEW');
  assert.equal(classifyRcPath('unrecognized-file').decision,'HUMAN_REVIEW');
  assert.equal(classifyRcPath('tests/fixtures/a/.agent-os/project.yaml').decision,'INCLUDE');
  assert.equal(m.source_fingerprint,deriveRcSourceManifest().source_fingerprint);
});
test('clean candidate contains only INCLUDE; active leakage remains fatal including guard-file additions',t=>{
  const root=path.join(temp(t),'candidate'),m=copyRcSource(SOURCE_ROOT,root);
  assert.equal(deriveRcSourceManifest(root).source_fingerprint,m.source_fingerprint);
  assert.equal(fs.existsSync(path.join(root,'.agent-os')),false);
  assert.equal(fs.existsSync(path.join(root,'docs/reports')),false);
  assert.equal(auditProductLeakage(root).status,'pass');
  assert.equal(auditProductPaths(root).status,'pass');
  fs.mkdirSync(path.join(root,'docs/reports'),{recursive:true});
  fs.writeFileSync(path.join(root,'docs/reports/history.md'),'speed-flexy historical reference');
  fs.mkdirSync(path.join(root,'docs/project/tasks'),{recursive:true});
  fs.writeFileSync(path.join(root,'docs/project/tasks/stale.json'),'C:/Apps/ForgeOS');
  assert.equal(auditProductPaths(root).status,'pass');
  fs.appendFileSync(path.join(root,'cli/forgeos.mjs'),'\n// C:/Apps/ForgeOS forbidden development dependency\n');
  assert.equal(auditProductPaths(root).status,'fail');
  assert.equal(auditProductLeakage(root).status,'pass');
  fs.appendFileSync(path.join(root,'bootstrap/validate-applied-adapter.mjs'),'\nconst leakedProject = "speed-flexy";\n');
  assert.equal(auditProductLeakage(root).status,'fail');
});
