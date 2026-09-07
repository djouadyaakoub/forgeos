/** Read-only bounded context preparation and reproducible proxy measurement; no host execution. */
import { performance } from 'node:perf_hooks';
import { readProjectText, projectRoot } from '../../host/project-files.mjs';
import { evaluatePreToolUse } from '../../policy/authority.mjs';
import { selectWorkflow } from './workflow-profile.mjs';
import { projectStatus } from './product-workflow.mjs';
import { retrieveKnowledge } from '../assessment/knowledge-lifecycle.mjs';
import { redactString } from '../deployment/redact.mjs';
const bytes = value => Buffer.byteLength(typeof value === 'string'?value:JSON.stringify(value));
function assertReadableContext(p, options) {
  if (/(^|[\\/])(\.env(?:\..*)?|.*\.(?:pem|key)|credentials|secrets)([\\/]|$)/i.test(p)) throw new Error('sensitive_context_path');
  const policy = evaluatePreToolUse({tool_name:'Read',tool_input:{path:p}});
  if (options.policy_decision === 'deny' || policy.permission !== 'allow') throw new Error('policy_denied_context');
}
export function inspectContext(options = {}) {
  const root = projectRoot(options.project_dir || process.cwd());
  const paths = [...new Set(options.paths || (options.path?[options.path]:[]))];
  if (paths.length > 64) throw new Error('context_path_limit');
  const workflow = selectWorkflow({action:'read',risk:options.risk || 'low', paths,requested:options.workflow,
    capability_id:options.capability_id,cross_domain:options.cross_domain});
  const start = performance.now(), stages=['intent','policy','focused_evidence'], evidence=[];
  let readBytes=0, selectedBytes=0;
  for (const p of paths) {
    assertReadableContext(p, options);
    const text = readProjectText(root,p);
    if (text === null) throw new Error('context_file_missing');
    readBytes += bytes(text);
    const content = redactString(text).slice(0,16000);
    if (selectedBytes + bytes(content) > 64000) throw new Error('context_byte_limit');
    selectedBytes += bytes(content);
    evidence.push({path:p,content,truncated:content.length < text.length});
  }
  let assessment=null,knowledge=null;
  if (workflow.profile === 'FULL') {
    stages.push('project_assessment','canvas');
    const status=projectStatus({...options,project_dir:root});
    if (!status.ok) return status;
    const findings=status.findings.slice(0,64).map(f=>({capability_id:f.capability_id,type:f.type,path:f.path,severity:f.severity}));
    assessment={project_id:status.project.id,pi:status.pi,canvas:status.canvas,findings,
      findings_total:status.findings.length,findings_omitted:Math.max(0,status.findings.length-findings.length),
      next_status:status.next.status,details_command:'status --json',authority:'derived_summary_not_approval'};
  }
  if (workflow.profile !== 'MINIMAL' || options.recall === true) {
    stages.push('knowledge_retrieval');knowledge=retrieveKnowledge(root,{paths,max_bytes:6000});
  }
  const context = {workflow,evidence,assessment,knowledge,authority:'read_only_context_not_task_approval_or_completion'};
  return {ok:true,status:'CONTEXT_READY',workflow,context,metrics:{classification:'MEASURED_CONTEXT_PROXY_NOT_MODEL_TOKENS',
    context_bytes:bytes(context),selected_evidence_bytes:selectedBytes,selected_files:evidence.length,
    explicit_evidence_reads:evidence.length,explicit_evidence_read_bytes:readBytes,
    internal_pi_reads:'not_instrumented',knowledge_bytes:knowledge?bytes(knowledge.items):0,
    retrieval_items:knowledge?.items.length||0,workflow_stages:stages,compute_ms:performance.now()-start},
    real_token_usage:'REAL_TOKEN_USAGE_UNAVAILABLE',executes:false};
}
export function benchmarkContext(options = {}) {
  const root = projectRoot(options.project_dir || process.cwd());
  const paths = options.paths || (options.path?[options.path]:['README.md']);
  if (!Array.isArray(paths) || !paths.length || paths.length > 64) throw new Error('context_path_limit');
  for (const p of paths) assertReadableContext(p,options);
  // Explicit controlled naive baseline: all supplied evidence once per scenario, no claim about vendor behavior.
  const naiveFiles = new Map();
  for (const p of paths) naiveFiles.set(p,bytes(readProjectText(root,p) || ''));
  const specs=[['tiny',paths.slice(0,1),'low'],['isolated_bug',paths.slice(0,1),'medium'],
    ['multi_file',paths,'medium'],['architecture',paths,'high'],['repeated',paths.slice(0,1),'medium'],
    ...['codex','cursor','claude-code'].map(h=>[`cross_host_${h}`,paths.slice(0,1),'medium',h])];
  const results=specs.map(([scenario,selected,risk,host])=>{
    const baselinePaths = ['tiny','isolated_bug'].includes(scenario)?selected:paths;
    const naiveBytes = baselinePaths.reduce((sum,p)=>sum+naiveFiles.get(p),0);
    const r=inspectContext({...options,project_dir:root,paths:selected,risk,workflow:undefined,host_id:host||options.host_id,recall:scenario==='repeated'});
    return {scenario,host:host||null,...r.metrics,profile:r.workflow.profile,naive_context_bytes:naiveBytes,
      naive_explicit_reads:baselinePaths.length,omitted_supplied_files:paths.length-selected.length,
      context_reduction_ratio:naiveBytes?1-r.metrics.context_bytes/naiveBytes:null};
  });
  return {ok:true,status:'BENCHMARK_COMPLETE',method:'controlled_naive_supplied_files_not_observed_vendor_workflow',
    real_token_usage:'REAL_TOKEN_USAGE_UNAVAILABLE',results,raw_context_persisted:false,
    limitations:['Byte proxies do not establish token cost or semantic correctness.','PI internal reads and vendor tool calls are not measured.',
      'Knowledge does not replace source evidence; relevant accepted items add bounded context.']};
}
