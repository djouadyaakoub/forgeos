#!/usr/bin/env node
/**
 * P0 release consumer E2E — must use EXTRACTED release artifact, not the dev checkout.
 *
 * Chain:
 *   build-release (caller may pre-build)
 *   → open ZIP / assert membership
 *   → extract TEMP
 *   → install-from-release --source EXTRACT
 *   → minimal project bootstrap + integrate-runtime (from EXTRACT scripts)
 *   → policy matrix via EXTRACT engine
 *   → orchestrator E2E via EXTRACT
 *   → source mutation check
 *   → restore install.json
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseProcessJson } from './process-json.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getCanonicalVersion } from '../../policy/version.mjs';
import { getInstallManifestPath } from '../../policy/plugin-root.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const VERSION = getCanonicalVersion();
const ARCHIVE = path.join(ROOT, 'release', `forgeos-${VERSION}.zip`);
const REQUIRED_ZIP_ENTRY = `forgeos-${VERSION}/templates/runtime/hook-shim.mjs`;

function fail(msg, detail = {}) {
  console.log(JSON.stringify({ check: 'extracted_release_e2e', status: 'fail', error: msg, ...detail }, null, 2));
  throw new Error(msg); // Preserve the enclosing finally: even a failed probe restores install state.
}

function run(nodeArgs, opts = {}) {
  const r = spawnSync(process.execPath, nodeArgs, {
    encoding: 'utf8',
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...opts.env },
    input: opts.input,
  });
  return r;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listZipEntries(zipPath) {
  // Prefer PowerShell Expand + walk after extract; for membership use Node zlib-free EOCD parse
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP EOCD missing');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    names.push(buf.slice(p + 46, p + 46 + nlen).toString('utf8'));
    p += 46 + nlen + elen + clen;
  }
  return names;
}

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // Use PowerShell Expand-Archive on Windows; unzip elsewhere
  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`],
      { encoding: 'utf8' },
    );
    if (ps.status !== 0) throw new Error(`Expand-Archive failed: ${ps.stderr || ps.stdout}`);
  } else {
    const r = spawnSync('unzip', ['-o', zipPath, '-d', destDir], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`unzip failed: ${r.stderr || r.stdout}`);
  }
}

if (!fs.existsSync(ARCHIVE)) {
  const build = run(['scripts/release/build-release.mjs']);
  if (build.status !== 0) fail('build-release failed', { stdout: build.stdout, stderr: build.stderr });
}
if (!fs.existsSync(ARCHIVE)) fail(`archive missing: ${ARCHIVE}`);

const entries = listZipEntries(ARCHIVE);
const leakedState = entries.filter(p=>/\/(?:\.agent-os|docs\/project|docs\/reports|docs\/research|tests|\.git|node_modules)\//.test(p)||/\.backup-\d+/.test(p));
if(leakedState.length)fail('maintainer or test state shipped',{paths:leakedState});
if (!entries.includes(REQUIRED_ZIP_ENTRY)) {
  fail('required ZIP entry missing', { required: REQUIRED_ZIP_ENTRY, sample: entries.filter((e) => e.includes('templates')).slice(0, 10) });
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeos-release-e2e-'));
const extractRoot = path.join(base, 'extracted');
const projectDir = path.join(base, 'project', 'ForgeOS-P0-Minimal');
extractZip(ARCHIVE, extractRoot);
const releaseDir = path.join(extractRoot, `forgeos-${VERSION}`);
if (!fs.existsSync(path.join(releaseDir, 'templates/runtime/hook-shim.mjs'))) {
  fail('extracted release missing shim', { releaseDir });
}

const installManifestPath = getInstallManifestPath();
const backupPath = path.join(base, 'install.json.backup');
if (fs.existsSync(installManifestPath)) fs.copyFileSync(installManifestPath, backupPath);

function restoreInstall() {
  if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, installManifestPath);
  else if (fs.existsSync(installManifestPath)) {
    const current=JSON.parse(fs.readFileSync(installManifestPath,'utf8'));
    if(path.resolve(current.plugin_root||'')===path.resolve(releaseDir))fs.unlinkSync(installManifestPath);
  }
}

try {
  // Clear env that could force the development checkout
  const cleanEnv = {
    FORGEOS_ROOT: '',
    CURSOR_AGENT_OS_PLUGIN_ROOT: '',
    AGENT_OS_PLUGIN_ROOT: '',
    FORGEOS_DEV_ROOT: '',
    AGENT_OS_DEV_ROOT: '',
    NODE_PATH: '',
  };

  const install = run(
    [path.join(releaseDir, 'bootstrap/install-from-release.mjs'), '--source', releaseDir],
    { env: cleanEnv },
  );
  if (install.status !== 0) fail('install-from-release failed', { stdout: install.stdout, stderr: install.stderr });
  let installReport;
  try {
    installReport = parseProcessJson(install, 'install');
  } catch (e) {
    fail('install output not JSON', { stdout: install.stdout, stderr: install.stderr, reason: e.message });
  }
  if (installReport.status !== 'INSTALLED') fail('install status not INSTALLED', { installReport });
  const installedRoot = path.resolve(installReport.source || '');
  if (path.resolve(installedRoot) !== path.resolve(releaseDir)) {
    fail('install did not point at extracted release', { installedRoot, releaseDir });
  }
  if (/[\\/]Apps[\\/]ForgeOS$/i.test(installedRoot.replace(/\//g, '\\'))) {
    fail('install resolved to development checkout', { installedRoot });
  }

  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'README.md'), '# ForgeOS P0 Minimal\n');
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'forgeos-p0-minimal', version: '0.0.1', private: true }, null, 2));
  fs.writeFileSync(path.join(projectDir, 'src/feature.js'), "export function greet(n='world'){return `Hello, ${n}!`;}\n");

  const sourceFiles = ['README.md', 'package.json', 'src/feature.js'];
  const before = Object.fromEntries(sourceFiles.map((f) => [f, sha256File(path.join(projectDir, f))]));

  const boot = run(
    [path.join(releaseDir, 'bootstrap/initialize.mjs'), '--apply-adapter', '--project-dir', projectDir],
    { env: { ...cleanEnv, CURSOR_PROJECT_DIR: projectDir } },
  );
  if (boot.status !== 0) fail('bootstrap --apply-adapter failed', { stdout: boot.stdout, stderr: boot.stderr });

  const integrate = run(
    [path.join(releaseDir, 'bootstrap/integrate-runtime.mjs'), '--project-dir', projectDir],
    { env: { ...cleanEnv, CURSOR_PROJECT_DIR: projectDir } },
  );
  if (integrate.status !== 0) fail('integrate-runtime failed', { stdout: integrate.stdout, stderr: integrate.stderr });
  if (!fs.existsSync(path.join(projectDir, '.cursor/hooks.json'))) fail('hooks.json missing after integrate');
  if (!fs.existsSync(path.join(projectDir, '.cursor/hooks/agent-os/policy-pre-tool.mjs'))) {
    fail('portable shim missing after integrate');
  }
  const hooksJson = fs.readFileSync(path.join(projectDir, '.cursor/hooks.json'), 'utf8');
  if (!hooksJson.includes('.cursor/hooks/agent-os/')) fail('hooks.json not portable');
  if (/[A-Za-z]:[\\/].*(?:ForgeOS|cursor-agent-os)/i.test(hooksJson)) fail('hooks.json contains absolute dev path');

  // Policy matrix using EXTRACTED engine modules
  const policyScript = `
import { dryRunScenario, saveSession, clearSession, evaluateApprovalForOperation } from '${pathToFileURL(path.join(releaseDir, 'policy/engine.mjs')).href}';
process.env.CURSOR_PROJECT_DIR = ${JSON.stringify(projectDir)};
const out = { tests: [] };
function add(name, got, expect) {
  out.tests.push({ name, expect, got: got.permission, pass: got.permission === expect, reason: got.reason });
}
clearSession();
add('ALLOW_read', dryRunScenario('read', { path: 'src/feature.js' }), 'allow');
clearSession();
add('BLOCK_git_push', dryRunScenario('shell', { agent: 'orchestrator', command: 'git push origin main' }), 'deny');
clearSession();
saveSession({ subagent_type: 'devops-release', task_id: 'FORGEOS-20260903-001' });
add('BLOCK_cross_task', evaluateApprovalForOperation('git_push', 'FORGEOS-20260903-002'), 'deny');
clearSession();
add('BLOCK_protected', dryRunScenario('write', { agent: 'orchestrator', path: '.cursor/hooks.json' }), 'deny');
out.passed = out.tests.filter(t => t.pass).length;
out.total = out.tests.length;
console.log(JSON.stringify(out));
process.exit(out.passed === out.total ? 0 : 1);
`;
  const policy = run(['--input-type=module', '-e', policyScript], { env: { ...cleanEnv, CURSOR_PROJECT_DIR: projectDir } });
  if (policy.status !== 0) fail('policy matrix failed', { stdout: policy.stdout, stderr: policy.stderr });

  const orch = run(
    [
      path.join(releaseDir, 'bootstrap/e2e-orchestrator.mjs'),
      '--project-dir',
      projectDir,
      '--task',
      'Inspect this project and identify which specialist should own a change to the example feature. Do not modify files.',
    ],
    { env: { ...cleanEnv, CURSOR_PROJECT_DIR: projectDir } },
  );
  if (orch.status !== 0) fail('orchestrator e2e failed', { stdout: orch.stdout, stderr: orch.stderr });
  if (/project is not iterable/i.test(orch.stderr || '') || /project is not iterable/i.test(orch.stdout || '')) {
    fail('orchestrator still hits empty-capabilities TypeError', { stdout: orch.stdout, stderr: orch.stderr });
  }

  // Stage 24: exercise the shipped host platform, not source-checkout imports.
  const hostPrepare = run([path.join(releaseDir, 'cli/host.mjs'), 'prepare', '--project', projectDir,
    '--host', 'claude-code', '--apply', '--json'], { env: cleanEnv });
  if (hostPrepare.status !== 0) fail('extracted host preparation failed', { stdout: hostPrepare.stdout, stderr: hostPrepare.stderr });
  const hostDoctor = run([path.join(releaseDir, 'cli/host.mjs'), 'doctor', '--project', projectDir,
    '--host', 'codex', '--json'], { env: cleanEnv });
  if (hostDoctor.status !== 0) fail('extracted host doctor failed', { stdout: hostDoctor.stdout, stderr: hostDoctor.stderr });
  const hostState = parseProcessJson(hostDoctor, 'hostDoctor');
  const aliasDir = path.join(base, 'release-alias');
  fs.symlinkSync(releaseDir, aliasDir, process.platform === 'win32' ? 'junction' : 'dir');
  const aliasDoctor = run([path.join(aliasDir, 'cli/host.mjs'), 'doctor', '--project', projectDir,
    '--host', 'codex', '--json'], { env: cleanEnv });
  const aliasState = parseProcessJson(aliasDoctor, 'extracted alias host doctor');
  if (JSON.stringify(aliasState) !== JSON.stringify(hostState)) fail('alias host output differs from direct output', { stderr: aliasDoctor.stderr });
  if (!hostState.handoff_ready || hostState.live_verified || hostState.contract.programmatic_agent_start) fail('extracted host contract incorrect');
  const knowledge = run([path.join(releaseDir, 'cli/knowledge.mjs'), '--project', projectDir, '--json'], { env: cleanEnv });
  if (knowledge.status !== 0) fail('extracted knowledge failed', { stderr: knowledge.stderr });
  const knowledgeState = parseProcessJson(knowledge, 'knowledge');
  if (!knowledgeState.facts?.fingerprint || knowledgeState.learning_scope !== 'project_only'
    || knowledgeState.policy_authority !== false) fail('extracted knowledge contract incorrect');
  const scopeScript = `import {createTaskScope,checkScopeContainment} from ${JSON.stringify(pathToFileURL(path.join(releaseDir, 'policy/task-scope.mjs')).href)};
    const scope = createTaskScope({project_dir:${JSON.stringify(projectDir)},task_id:'S25-package',capability_id:'documentation-sync',allowed_paths:['docs/**']}).scope;
    if (!scope || !checkScopeContainment(scope,{action_class:'write',path:'docs/a.md'}).ok || checkScopeContainment(scope,{action_class:'write',path:'src/a.js'}).ok) process.exit(1);`;
  const scopeProbe = run(['--input-type=module', '-e', scopeScript], { env: cleanEnv });
  if (scopeProbe.status !== 0) fail('extracted task scope containment failed', { stderr: scopeProbe.stderr });
  // Stage 26: shipped product status, candidate/review/recall and inert discovery APIs.
  const productCli = path.join(releaseDir, 'cli/forgeos.mjs');
  const productStatus = run([productCli,'status','--project',projectDir,'--host','codex','--json'], {env:cleanEnv});
  if (productStatus.status !== 0 || !parseProcessJson(productStatus, 'productStatus').pi?.fingerprint) fail('extracted product status failed');
  const addKnowledge = run([productCli,'knowledge','add','--project',projectDir,'--id','package-knowledge',
    '--text','Package guidance is available for interactive work.','--source','package-agent','--evidence','AGENTS.md','--json'],{env:cleanEnv});
  if(addKnowledge.status !== 0 || parseProcessJson(addKnowledge, 'addKnowledge').candidate?.review_status !== 'UNREVIEWED') fail('extracted candidate writeback failed');
  const acceptKnowledge = run([productCli,'knowledge','accept','--project',projectDir,'--id','package-knowledge',
    '--reviewer','package-operator','--confirm-human','--note','Controlled extracted test operator simulation','--json'],{env:cleanEnv});
  if(acceptKnowledge.status !== 0) fail('extracted review failed');
  const recall = run([productCli,'knowledge','recall','--project',projectDir,'--json'],{env:cleanEnv});
  if(recall.status !== 0 || parseProcessJson(recall, 'recall').items?.length !== 1) fail('extracted accepted retrieval failed');
  const discoveryScript = `import {assessDiscoveryCandidate} from ${JSON.stringify(pathToFileURL(path.join(releaseDir,'intelligence/capability/discovery.mjs')).href)};
    const r=assessDiscoveryCandidate({candidate_id:'package-candidate',source_kind:'MCP',name:'Fixture',description:'Metadata only',source:'fixture',url:'https://example.org',revision:'fixture',license:'MIT',discovered_at:'2026-01-01T00:00:00Z',expires_at:'2099-01-01T00:00:00Z',claims:['example'],requirements:{network:true,docker:false,external_runtime:false},provenance:{observer:'test',evidence:'Controlled fixture'}});
    if(r.status!=='ELIGIBLE'||r.registered||r.executable||r.policy_approved) process.exit(1);`;
  const discoveryProbe = run(['--input-type=module','-e',discoveryScript],{env:cleanEnv});
  if(discoveryProbe.status !== 0) fail('extracted inert discovery failed',{stderr:discoveryProbe.stderr});
  const lifecycleScript = `import {createTaskCandidate} from ${JSON.stringify(pathToFileURL(path.join(releaseDir,'intelligence/assessment/task-candidate.mjs')).href)};
    import {createHostHandoff} from ${JSON.stringify(pathToFileURL(path.join(releaseDir,'intelligence/orchestrator/host-handoff.mjs')).href)};
    import {completeProjectTask} from ${JSON.stringify(pathToFileURL(path.join(releaseDir,'intelligence/orchestrator/product-workflow.mjs')).href)};
    const root=${JSON.stringify(projectDir)};
    const c=createTaskCandidate({project_dir:root,task_id:'package-lifecycle',capability_id:'documentation-sync',agent_id:'docs-sync',allowed_paths:['AGENTS.md'],verification_strategy:'presence',verification_presence:['AGENTS.md']}).candidate;
    const h=createHostHandoff({project_dir:root,candidate:c,host_id:'codex',persist:true});
    if(!h.ok)throw new Error(h.reason);
    const r=completeProjectTask({project_dir:root,host_id:'codex',task_id:c.task_id,learning:'Package verification is independent of knowledge acceptance.'});
    if(r.verification_status!=='PASS'||r.knowledge?.candidate?.review_status!=='UNREVIEWED'||!r.evidence?.evidence_id||!r.canvas_after?.derived)throw new Error(JSON.stringify(r));`;
  const lifecycleProbe=run(['--input-type=module','-e',lifecycleScript],{env:cleanEnv});
  if(lifecycleProbe.status!==0)fail('extracted product lifecycle failed',{stderr:lifecycleProbe.stderr});
  // Product hardening is exercised through shipped entrypoints in a separate temporary consumer fixture.
  const semanticDir=path.join(base,'semantic-consumer');
  fs.mkdirSync(semanticDir); fs.mkdirSync(path.join(semanticDir,'docs'));
  fs.writeFileSync(path.join(semanticDir,'package.json'),'{"name":"semantic-consumer"}');
  fs.writeFileSync(path.join(semanticDir,'README.md'),'# Consumer\nNode.js\n');
  const shippedPackage=JSON.parse(fs.readFileSync(path.join(releaseDir,'package.json'),'utf8'));
  if(shippedPackage.bin?.forgeos!=='cli/forgeos.mjs') fail('extracted bin mapping missing');
  const publicCli=(...args)=>run([productCli,...args,'--project',semanticDir,'--host','codex','--json'],{env:cleanEnv});
  const init27=publicCli('init','--apply');
  if(init27.status!==0)fail('extracted init failed',{stderr:init27.stderr});
  const minimal27=publicCli('inspect','--path','README.md');
  if(minimal27.status!==0||parseProcessJson(minimal27, 'minimal27').workflow?.profile!=='MINIMAL')fail('extracted minimal workflow failed');
  const scoped28=publicCli('inspect','--path','README.md','--risk','medium');
  if(scoped28.status!==0||parseProcessJson(scoped28, 'scoped28').workflow?.profile!=='SCOPED')fail('extracted scoped workflow failed');
  const full28=publicCli('inspect','--path','README.md','--risk','high','--workflow','minimal');
  if(full28.status!==0||parseProcessJson(full28, 'full28').workflow?.profile!=='FULL')fail('extracted full workflow floor failed');
  for(const host of ['codex','cursor','claude-code']) {
    const preparation=run([productCli,'host','prepare','--project',semanticDir,'--host',host,'--apply','--json'],{env:cleanEnv});
    if(preparation.status!==0)fail('extracted host preparation failed',{host,stderr:preparation.stderr});
    const doctor=run([productCli,'host','doctor','--project',semanticDir,'--host',host,'--json'],{env:cleanEnv});
    const state=parseProcessJson(doctor, 'doctor');
    if(doctor.status!==0||!state.handoff_ready||state.live_verified||state.contract.programmatic_agent_start)fail('extracted host contract failed',{host,state});
  }
  const prep27=publicCli('next','--capability','documentation-sync','--path','docs/STACK.md','--prepare');
  if(prep27.status!==0)fail('extracted semantic preparation failed',{stdout:prep27.stdout,stderr:prep27.stderr});
  const task27=parseProcessJson(prep27, 'prep27').handoff?.task_id;
  if(!task27)fail('extracted semantic task missing');
  const fail27=publicCli('complete','--task',task27,'--changed','docs/STACK.md');
  if(parseProcessJson(fail27, 'fail27', 2).verification_status!=='FAIL')fail('extracted missing document falsely passed');
  fs.writeFileSync(path.join(semanticDir,'docs/STACK.md'),'# Stack\nNode.js\n');
  const pass27=publicCli('complete','--task',task27,'--changed','docs/STACK.md');
  if(pass27.status!==0||!parseProcessJson(pass27, 'pass27').capability_satisfied)fail('extracted semantic verification failed',{stdout:pass27.stdout});
  const benchmark27=publicCli('benchmark','context','--evidence','README.md');
  if(benchmark27.status!==0||parseProcessJson(benchmark27, 'benchmark27').real_token_usage!=='REAL_TOKEN_USAGE_UNAVAILABLE')fail('extracted benchmark failed');
  const babelProbe=expected=>run(['--input-type=module','-e',`
    import {createRequire} from 'node:module';
    import {tryLoadBabelParser} from ${JSON.stringify(pathToFileURL(path.join(releaseDir,'intelligence/adapters/babel-parser/index.mjs')).href)};
    import {runStructuralAnalysis} from ${JSON.stringify(pathToFileURL(path.join(releaseDir,'intelligence/adapters/index.mjs')).href)};
    const available=tryLoadBabelParser().available;
    const {assertParserLocality}=await import(${JSON.stringify(new URL('./physical-locality.mjs',import.meta.url).href)});
    let locality=null;
    if(available!==${expected})throw new Error('unexpected_optional_parser_availability');
    if(available) {
      const r=createRequire(${JSON.stringify(pathToFileURL(path.join(releaseDir,'intelligence/adapters/babel-parser/index.mjs')).href)});
      locality=assertParserLocality(${JSON.stringify(releaseDir)},r.resolve('@babel/parser'));
    }
    const r=runStructuralAnalysis({project_dir:${JSON.stringify(projectDir)},persist_cache:false,use_cache:false});
    if(!r.ok||r.adapter_id!==(${expected}?'babel-parser':'forgeos-structural'))throw new Error(JSON.stringify(r));
    console.log(JSON.stringify({available,adapter:r.adapter_id,status:r.facts.status,locality}));
  `],{env:cleanEnv,cwd:releaseDir});
  const missingBabel=babelProbe(false);
  if(missingBabel.status!==0)fail('extracted optional Babel fallback failed',{stderr:missingBabel.stderr});
  const dependencies=spawnSync('npm ci --ignore-scripts --no-audit --no-fund',{cwd:releaseDir,shell:true,encoding:'utf8',timeout:120000,env:{...process.env,...cleanEnv}});
  if(dependencies.status!==0)fail('extracted locked optional install failed',{stderr:dependencies.stderr});
  const presentBabel=babelProbe(true);
  if(presentBabel.status!==0)fail('extracted installed Babel failed',{stderr:presentBabel.stderr});
  const after = Object.fromEntries(sourceFiles.map((f) => [f, sha256File(path.join(projectDir, f))]));
  const mutated = sourceFiles.filter((f) => before[f] !== after[f]);
  if (mutated.length) fail('unauthorized source mutations', { mutated });

  console.log(JSON.stringify({
    check: 'extracted_release_e2e',
    status: 'pass',
    version: VERSION,
    archive: ARCHIVE.replace(/\\/g, '/'),
    release_dir: releaseDir.replace(/\\/g, '/'),
    project_dir: projectDir.replace(/\\/g, '/'),
    zip_entry: REQUIRED_ZIP_ENTRY,
    install: installReport.status,
    policy: parseProcessJson(policy, 'policy'),
    orchestrator_exit: orch.status,
    rc3_alias: { tested: true, json_output: true, same_as_direct: true },
    host_platform: { prepared: parseProcessJson(hostPrepare, 'hostPrepare').ok, doctor_ready: hostState.handoff_ready, live_verified: false },
    stage25: { knowledge_partition: true, scope_containment: true },
    stage26: { product_status:true, candidate_writeback:true, explicit_review:true, accepted_retrieval:true, inert_discovery:true, verified_lifecycle:true },
    stage27: {bin_mapping:true,init:true,minimal_without_full_assessment:true,semantic_fail_then_pass:true,context_benchmark:true},
    stage28: {local_state_excluded:true,scoped:true,full_risk_floor:true,hosts:['codex','cursor','claude-code'],babel_absent:parseProcessJson(missingBabel, 'missingBabel'),babel_present:parseProcessJson(presentBabel, 'presentBabel'),dependency_install:'npm ci --ignore-scripts --no-audit --no-fund'},
    source_mutations: mutated,
  }, null, 2));
} finally {
  restoreInstall();
  try {
    fs.rmSync(base, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

process.exit(0);
