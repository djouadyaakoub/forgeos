#!/usr/bin/env node
/** Reproduce from INCLUDE files only. Temporary logs are evidence, never source or publication. */
import fs from 'node:fs';
import { isExecutedAsMain } from '../../cli/main.mjs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deriveRcSourceManifest, SOURCE_ROOT } from './rc-source-manifest.mjs';
const sha = b=>crypto.createHash('sha256').update(b).digest('hex');
export function copyRcSource(root, destination) {
  const manifest=deriveRcSourceManifest(root);
  if(fs.existsSync(destination))throw new Error('candidate_destination_must_not_exist');
  for(const f of manifest.files.filter(f=>f.decision==='INCLUDE')) {
    const to=path.join(destination,f.path);fs.mkdirSync(path.dirname(to),{recursive:true});
    fs.copyFileSync(path.join(root,f.path),to);
    if(sha(fs.readFileSync(to))!==f.sha256)throw new Error(`source_changed_during_copy:${f.path}`);
  }
  return manifest;
}
export function fixtureSnapshot(root) {
  const files={};
  function walk(rel) {
    if(!fs.existsSync(path.join(root,rel)))return;
    for(const e of fs.readdirSync(path.join(root,rel),{withFileTypes:true})) {
      const p=rel+'/'+e.name;
      if(e.isDirectory())walk(p);
      else if(e.isFile())files[p]=sha(fs.readFileSync(path.join(root,p)));
    }
  }
  walk('tests/fixtures');
  const git=spawnSync('git',['status','--porcelain=v1','--untracked-files=all'],{cwd:root,encoding:'utf8'});
  return {file_count:Object.keys(files).length,files,dirty_count:git.status===0?git.stdout.trim().split(/\r?\n/).filter(Boolean).length:null};
}
export const RC_SUITES=['test:rc3','test','test:policy','test:bootstrap','test:adapter','test:runtime','test:plugin',
  'test:intelligence','test:orchestration','test:deployment','test:neutrality','test:project-intelligence',
  'test:stage8','test:stage9','test:stage10','test:stage11','test:stage12','test:stage14','test:runtime-execution',
  'test:stage19','test:stage22','test:stage23','test:stage24','test:stage25','test:stage26','test:stage27','test:stage28','test:stage29','test:stage30','test:stage31a','test:distribution','test:security'];
function runGate() {
  const inPlace=process.argv.includes('--hygiene');
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'forgeos-rc-source-'));
  const source=path.join(base,'candidate');
  const manifest=inPlace?deriveRcSourceManifest(SOURCE_ROOT):copyRcSource(SOURCE_ROOT,source);
  const root=inPlace?SOURCE_ROOT:source;
  const result={schema:'forgeos-rc-reproduction',at:new Date().toISOString(),platform:process.platform,node:process.version,
    root,evidence_directory:base,source_fingerprint:manifest.source_fingerprint,included:manifest.files.filter(f=>f.decision==='INCLUDE').length,
    steps:[],snapshots:[fixtureSnapshot(root)]};
  const persist=()=>fs.writeFileSync(path.join(base,'result.json'),JSON.stringify(result,null,2));
  console.log(`Evidence: ${base}`);persist();
  function step(command,name=command) {
    const start=Date.now();
    const r=spawnSync(command,{cwd:root,shell:true,encoding:'utf8',maxBuffer:32*1024*1024,timeout:600000,
      env:{...process.env,FORGEOS_ROOT:'',AGENT_OS_PLUGIN_ROOT:'',CURSOR_AGENT_OS_PLUGIN_ROOT:'',FORGEOS_DEV_ROOT:'',AGENT_OS_DEV_ROOT:'',FORGEOS_LIVE_PROJECT_TESTS:'0'}});
    fs.writeFileSync(path.join(base,`${result.steps.length}-${name.replace(/[^a-z0-9-]/gi,'_')}.log`),(r.stdout||'')+'\n'+(r.stderr||''));
    result.steps.push({command,name,exit:r.status,error:r.error?.message,ms:Date.now()-start});persist();
    console.log(`${r.status===0?'PASS':'FAIL'} ${name} (${Date.now()-start}ms)`);
    return r.status===0;
  }
  let ok=inPlace||step('npm ci --ignore-scripts --no-audit --no-fund');
  for(let pass=0;pass<(inPlace?2:1)&&ok;pass++) {
    for(const suite of RC_SUITES)if(!step(suite==='test'?'npm test':`npm run ${suite}`,`pass${pass+1}-${suite}`)){ok=false;break;}
    const before=result.snapshots.at(-1),after=fixtureSnapshot(root);result.snapshots.push(after);
    const added=Object.keys(after.files).filter(p=>!Object.hasOwn(before.files,p));
    const changed=Object.keys(before.files).filter(p=>before.files[p]!==after.files[p]);
    result.hygiene={...(result.hygiene||{}),[`pass${pass+1}`]:{added,changed}};
    // A clean candidate may create deterministic test fixtures on its first pass; an existing checkout must remain read-only.
    if(inPlace&&(added.length||changed.length))ok=false;
    persist();
  }
  if(!inPlace&&ok) {
    ok=step('npm run validate-release');
    const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
    const rel=`release/forgeos-${version}.zip`;
    if(ok&&fs.existsSync(path.join(SOURCE_ROOT,rel))) {
      result.archive_sha256=sha(fs.readFileSync(path.join(root,rel)));
      result.checkout_archive_sha256=sha(fs.readFileSync(path.join(SOURCE_ROOT,rel)));
      result.archive_matches_checkout=result.archive_sha256===result.checkout_archive_sha256;
      ok=ok&&result.archive_matches_checkout;
    } else if(ok) {ok=false;result.reason='build_checkout_archive_before_reproduction';}
  }
  result.ok=ok;persist();console.log(JSON.stringify({ok,evidence:path.join(base,'result.json'),hygiene:result.hygiene,archive_matches_checkout:result.archive_matches_checkout},null,2));
  process.exitCode=ok?0:1;
}
if(isExecutedAsMain(import.meta.url))runGate();
