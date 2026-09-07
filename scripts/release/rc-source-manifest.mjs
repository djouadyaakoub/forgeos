/** Deterministic source/distribution decisions. No Git mutation and no dependency on Git presence. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const SOURCE_ROOT = fileURLToPath(new URL('../../',import.meta.url));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
export function classifyRcPath(value) {
  const p=value.replace(/\\/g,'/');
  let category='UNKNOWN_REQUIRES_HUMAN',decision='HUMAN_REVIEW',distribution=false;
  const set=(c,d='INCLUDE',ship=false)=>{category=c;decision=d;distribution=ship;};
  if (/^release\/(?:cursor-agent-os|forgeos)-1\.0\.0\.zip$/.test(p)) set('OBSOLETE_ARTIFACT','HUMAN_REVIEW');
  else if (p==='release/release-manifest.json') set('SCHEMA'); // release metadata input; artifacts field rebuilt
  else if (p.startsWith('release/')) set('GENERATED_RELEASE_ARTIFACT','EXCLUDE');
  else if (p.startsWith('.agent-os/')||/^docs\/project\/tasks\//.test(p)||/^\.env(?:\.|$)/.test(p)) set('LOCAL_PROJECT_STATE','EXCLUDE');
  else if (p.startsWith('docs/project/')) set('GENERATED_ASSESSMENT','EXCLUDE');
  else if (/^tests\/fixtures\/version-bad\//.test(p)||/^tests\/fixtures\/.*\/\.env(?:\.|$)/.test(p)&&!p.endsWith('.env.example')) set('GENERATED_FIXTURE','EXCLUDE');
  else if (/^tests\/fixtures\/.*(?:\.backup-\d+|\.forgeos-backup-\d+)$/.test(p)||/^tests\/fixtures\/.*\/docs\/project\//.test(p)
    ||/^tests\/fixtures\/phase(?:19|21)-/.test(p)||/^tests\/fixtures\/.*\/docs\/agents\/(?:learning|research)\//.test(p)) set('GENERATED_FIXTURE','EXCLUDE');
  else if (p.startsWith('tests/')||p.startsWith('policy/tests/')) set('TEST');
  else if (p.startsWith('docs/research/')) set('RESEARCH','HUMAN_REVIEW');
  else if (p.startsWith('docs/reports/')||p.startsWith('docs/release/')||/^docs\/.*(?:PHASE-|REPORT|STATUS)/.test(p)) set('HISTORICAL_REPORT','HUMAN_REVIEW');
  else if (p.startsWith('docs/')||['README.md','CHANGELOG.md','LICENSE','AGENTS.md','CLAUDE.md'].includes(p)) set('CANONICAL_DOCUMENTATION','INCLUDE',!['AGENTS.md','CLAUDE.md'].includes(p));
  else if (p.startsWith('cli/')) set('PRODUCT_CLI','INCLUDE',true);
  else if (/^(?:policy|hooks|rules)\//.test(p)) set('POLICY_GOVERNANCE','INCLUDE',true);
  else if (p.startsWith('intelligence/')) set('PROJECT_INTELLIGENCE','INCLUDE',true);
  else if (/^(?:host|adapters|\.cursor-plugin)\//.test(p)) set('HOST_INTEGRATION','INCLUDE',true);
  else if (p.startsWith('schemas/')) set('SCHEMA','INCLUDE',true);
  else if (/^(?:runtime|bootstrap|templates|skills|agents)\//.test(p)) set('PRODUCT_RUNTIME','INCLUDE',true);
  else if (p.startsWith('scripts/')||p.startsWith('.github/')||['.gitignore','.gitattributes'].includes(p)) set('POLICY_GOVERNANCE');
  else if (['package.json','package-lock.json'].includes(p)) set('PRODUCT_RUNTIME','INCLUDE',true);
  return {category,decision,required_for_distribution:distribution};
}
export function deriveRcSourceManifest(root=SOURCE_ROOT) {
  const files=[];
  function walk(relative='') {
    const absolute=path.join(root,relative);
    for(const d of fs.readdirSync(absolute,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(['.git','node_modules','.cursor','.cache','.npm','coverage'].includes(d.name)) continue;
      const p=(relative?relative+'/':'')+d.name;
      if (p==='release/dist') continue;
      const classification=classifyRcPath(p);
      if(d.isSymbolicLink()) {files.push({path:p,category:'UNKNOWN_REQUIRES_HUMAN',decision:'HUMAN_REVIEW',required_for_distribution:false,reason:'symlink_not_source'});continue;}
      if(d.isDirectory())walk(p);
      else if(d.isFile()) files.push({path:p,...classification,required_for_tests:classification.category==='TEST',
        required_for_runtime:classification.required_for_distribution && !['CANONICAL_DOCUMENTATION','SCHEMA'].includes(classification.category),
        sha256:classification.decision==='INCLUDE'?sha(fs.readFileSync(path.join(root,p))):null});
    }
  }
  walk();files.sort((a,b)=>a.path.localeCompare(b.path));
  const included=files.filter(f=>f.decision==='INCLUDE');
  for(const required of ['package.json','package-lock.json','agents/registry.yaml','cli/forgeos.mjs','policy/authority.mjs','release/release-manifest.json'])
    if(!included.some(f=>f.path===required))throw new Error(`required_rc_source_missing:${required}`);
  return {schema:'forgeos-rc-source-manifest',schema_version:1,files,
    source_fingerprint:sha(JSON.stringify(included.map(f=>[f.path,f.sha256]))),
    authority:'source_inclusion_only_not_git_or_publication_authorization'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(deriveRcSourceManifest(process.argv[2]||SOURCE_ROOT),null,2));
