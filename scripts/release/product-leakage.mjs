import fs from 'node:fs';
import path from 'node:path';
import { deriveRcSourceManifest } from './rc-source-manifest.mjs';
const knownNegativeGuards = new Set([
  "check('no speed-flexy paths in manifest', () => !/speed-flexy|backend\\/internal\\/api\\/server\\.go|fly\\.toml/i.test(yaml));",
  "return !blob.includes('speed-flexy') && !blob.includes('speed_flexy');",
]);
export function auditProductPaths(root) {
  const offenders=[];
  for(const f of deriveRcSourceManifest(root).files.filter(f=>f.required_for_distribution)) {
    if(!/\.(?:mjs|js|json|md|ya?ml)$/.test(f.path))continue;
    const content=fs.readFileSync(path.join(root,f.path),'utf8');
    if(/C:[\\/]+Apps[\\/]+(?:ForgeOS|cursor-agent-os|speed-flexy-server)/i.test(content))offenders.push({file:f.path});
  }
  return {check:'no_local_paths',status:offenders.length?'fail':'pass',offenders,
    scope:'all_distribution_files; non-shipped historical and local state excluded by RC source manifest'};
}
export function auditProductLeakage(root) {
  const manifest=deriveRcSourceManifest(root),offenders=[],classified=[];
  for(const f of manifest.files) {
    if(!/\.(?:mjs|js|json|md|ya?ml)$/.test(f.path))continue;
    const text=fs.readFileSync(path.join(root,f.path),'utf8');
    const hits=text.split(/\r?\n/).flatMap((line,i)=>/speed[-_]flexy/i.test(line)?[{line:i+1,text:line.trim()}]:[]);
    if(!hits.length)continue;
    if(['HISTORICAL_REPORT','RESEARCH','GENERATED_FIXTURE','GENERATED_ASSESSMENT','LOCAL_PROJECT_STATE'].includes(f.category)) {
      classified.push({path:f.path,kind:'non_shipped_history_or_state',hits:hits.length});continue;
    }
    if(f.category==='TEST'||!f.required_for_distribution) {classified.push({path:f.path,kind:'non_shipped_test_or_tool',hits:hits.length});continue;}
    for(const hit of hits) {
      if(f.path==='bootstrap/validate-applied-adapter.mjs' && knownNegativeGuards.has(hit.text))
        classified.push({path:f.path,line:hit.line,kind:'exact_negative_guard'});
      else offenders.push({path:f.path,line:hit.line,kind:'active_product_leakage'});
    }
  }
  return {check:'no_speed_flexy_leakage',status:offenders.length?'fail':'pass',offenders,classified,
    scope:'shipped_product_and_canonical_docs; exact negative guards and non-shipped history distinguished'};
}
