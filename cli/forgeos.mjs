#!/usr/bin/env node
/** One product entrypoint; legacy CLIs remain supported. No automatic execution. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectStatus, nextProjectAction, completeProjectTask } from '../intelligence/orchestrator/product-workflow.mjs';
import { listKnowledge, retrieveKnowledge, writeKnowledgeCandidate, reviewKnowledge } from '../intelligence/assessment/knowledge-lifecycle.mjs';
import { discoverCandidate, listDiscovery } from '../intelligence/capability/discovery.mjs';
import { readProjectText } from '../host/project-files.mjs';
import { prepareHostProject } from '../host/preparation.mjs';
import { runForgeOsHostCli } from './host.mjs';
import { inspectContext, benchmarkContext } from '../intelligence/orchestrator/context-diagnostic.mjs';
import { runExactApprovalCli } from './approve.mjs';
export const HELP = `ForgeOS — interactive project control plane
Usage: node cli/forgeos.mjs <command> [options]
  init --host ID [--apply]     Preview existing host preparation; --apply creates missing files only
  host <action>               Existing host doctor/status/prepare/config interface
  approve --file PATH          Preview exact high-risk intent JSON; never executes
                              Confirm with --confirm-human --by ID --expires-at UTC --confirm-fingerprint HASH
  inspect --path PATH         Bounded read-only context, avoids full assessment for low-risk files
  benchmark context           Measured context-byte proxies; --evidence PATH repeatable
  status | inspect | assess    Current PI, findings, tasks, Canvas, knowledge and next action
  next                        Explain choices; --capability ID or --finding ID selects
  next --prepare              Persist same-workspace handoff, never execute
  complete --task ID          ForgeOS verification; --changed PATH repeatable
                              --learning "compact observation" creates unreviewed knowledge
  knowledge list | inspect --id ID | recall
  knowledge add --text TEXT --evidence PATH --source ID
  knowledge accept|reject --id ID --reviewer ID --confirm-human --note TEXT
  knowledge reject --id ID --reviewer ID --agent-rejection --note TEXT
  discovery add --file PATH    Local project-relative metadata JSON, never executable
  discovery list | assess     Deterministic metadata assessment, no registration
Common: --project DIR --host codex|cursor|claude-code --json
Workflow: --workflow minimal|scoped|full (stronger only); --risk low|medium|high for read-only inspect
Selection: --task ID --capability ID --finding ID; --path PATH narrows prepared write scope
Knowledge recall: --capability ID --task ID --evidence PATH --max-count N --max-bytes N
Acceptance is an explicit local operator assertion, not authenticated human identity.
No command here installs, publishes, launches a host or executes candidate metadata.`;
function runProductCliInternal(argv = process.argv.slice(2)) {
  try {
    const flags = {}, position = [], repeats = {changed:[],evidence:[]};
    if(argv[0]==='approve') return runExactApprovalCli(argv.slice(1));
    if(argv[0]==='host') return runForgeOsHostCli(['node','host',...argv.slice(1)],{print:false});
    const bool = new Set(['json','prepare','apply','confirm-human','agent-rejection','help']);
    const values = new Set(['project','host','task','capability','finding','path','learning','id','text','source','reviewer','note','file','max-count','max-bytes','workflow','risk']);
    for(let i=0;i<argv.length;i++) {
      if (!argv[i].startsWith('--')) {position.push(argv[i]);continue;}
      const key=argv[i].slice(2);
      if(bool.has(key)) {flags[key]=true;continue;}
      if(!values.has(key)&&!Object.hasOwn(repeats,key)) throw new Error('unsupported_option');
      if(!argv[i+1]||argv[i+1].startsWith('--')) throw new Error('missing_option_value');
      if(Object.hasOwn(repeats,key)) repeats[key].push(argv[++i]);
      else {if(Object.hasOwn(flags,key)) throw new Error('duplicate_option');flags[key]=argv[++i];}
    }
    const [command='status',action='list']=position;
    if(position.length>(['knowledge','discovery','benchmark'].includes(command)?2:1)) throw new Error('extra_argument');
    if(flags.help||command==='help') return {ok:true,help:HELP};
    const root=flags.project||process.cwd(),options={project_dir:root,host_id:flags.host,task_id:flags.task,capability_id:flags.capability,
      finding_id:flags.finding,prepare:flags.prepare,path:flags.path,learning:flags.learning,changed_paths:repeats.changed,workflow:flags.workflow,risk:flags.risk};
    if(command==='init') return prepareHostProject({...options,apply:flags.apply===true});
    if(command==='benchmark' && action==='context') return benchmarkContext({...options,paths:repeats.evidence.length?repeats.evidence:undefined});
    if(command==='inspect' && flags.path) return inspectContext(options);
    if(['status','inspect','assess'].includes(command)) return projectStatus(options);
    if(command==='next') return nextProjectAction(options);
    if(command==='complete'||command==='verify') return completeProjectTask(options);
    if(command==='knowledge') {
      if(action==='add') return writeKnowledgeCandidate(root,{id:flags.id,text:flags.text,evidence_refs:repeats.evidence,source:flags.source,capability_id:flags.capability});
      if(['accept','reject'].includes(action)) return reviewKnowledge(root,flags.id,action==='accept'?'ACCEPTED':'REJECTED',
        {kind:flags['agent-rejection']?'agent':'human',id:flags.reviewer,confirmed:flags['confirm-human']===true||flags['agent-rejection']===true},flags.note);
      if(action==='recall') return retrieveKnowledge(root,{task_id:flags.task,capability_id:flags.capability,paths:repeats.evidence,
        max_count:flags['max-count']===undefined?undefined:Number(flags['max-count']),max_bytes:flags['max-bytes']===undefined?undefined:Number(flags['max-bytes'])});
      const state=listKnowledge(root);
      if(action==='list') return {ok:true,interpretations:state.interpretations};
      if(action==='inspect') {const row=state.interpretations.find(r=>r.id===flags.id);if(!row)throw new Error('knowledge_not_found');return {ok:true,interpretation:row};}
    }
    if(command==='discovery') {
      if(action==='add') return discoverCandidate(root,JSON.parse(readProjectText(root,flags.file)||'null'));
      if(['list','assess'].includes(action)) return {ok:true,candidates:listDiscovery(root,{assess:action==='assess'})};
    }
    throw new Error('unknown_command');
  } catch(e) {return {ok:false,status:'BLOCKED',reason:e.message};}
}
/** Add stable user-facing diagnostics without changing established result/status contracts. */
export function productDiagnostic(result) {
  const reason=String(result.reason||'');
  if(/scope_(?:path|workspace|context)|outside_task_scope|unsafe_project_path|project_symlink/.test(reason))return 'SCOPE_VIOLATION';
  if(/stale|handoff_missing|assessment_selection_changed/.test(reason)||result.status==='STALE')return 'STALE_TASK';
  if(/host_configuration|configured_host|invalid_local_store|local_store|JSON|Unexpected token|Unexpected end/.test(reason))return 'MALFORMED_LOCAL_STATE';
  if(/unsupported_host|unknown_host/.test(reason))return 'UNSUPPORTED_HOST';
  if(/ENOENT|ENOTDIR|workspace_missing|invalid_project/.test(reason))return 'INVALID_PROJECT';
  if(/review_required|self_review_forbidden/.test(reason))return 'KNOWLEDGE_REVIEW_REQUIRED';
  if(result.status==='POLICY_DENIED'||/policy_deny|protected_path|tool_profile_no_write|handoff_only_writes/.test(reason))return 'POLICY_DENIED';
  if(['VERIFICATION_FAILED','NO_ACTIONABLE_TASK','AMBIGUOUS_NEXT_ACTION','KNOWLEDGE_REVIEW_REQUIRED'].includes(result.status))return result.status;
  return null;
}
export function runProductCli(argv = process.argv.slice(2)) {
  const result=runProductCliInternal(argv),code=productDiagnostic(result);
  return code?{...result,diagnostic_code:code}:result;
}
export function formatProductResult(r) {
  if(r.help)return r.help;
  if(r.preview) return JSON.stringify(r,null,2);
  const lines=[`ForgeOS: ${r.status || (r.ok?'READY':'BLOCKED')}`];
  if(r.reason)lines.push(`Reason: ${r.reason}`);
  if(r.diagnostic_code)lines.push(`Diagnostic: ${r.diagnostic_code}`);
  if(r.workflow)lines.push(`Workflow: ${r.workflow.profile}: ${r.workflow.reasons.join(', ')}`);
  if(r.metrics)lines.push(JSON.stringify(r.metrics),r.real_token_usage);
  if(r.results)lines.push(JSON.stringify(r.results,null,2),r.real_token_usage);
  if(r.actions)lines.push(...r.actions.map(a=>`${r.apply?'Created/planned':'Preview'}: ${a.path}`));
  if(r.project)lines.push(`Project: ${r.project.id || r.project.dir}`,`Host: ${r.host.selection.host_id}; ready=${r.host.handoff_ready}; live=unverified`,
    `PI: ${r.pi.freshness}, coverage=${r.pi.coverage}`,`Canvas: satisfied=${r.canvas.satisfied}, partial=${r.canvas.partial}, unknown=${r.canvas.unknown}`,
    `Findings: ${r.findings.length}; tasks=${r.tasks.length}; knowledge=${r.knowledge.length}`,`Next: ${r.next.status}`);
  for(const c of r.choices||[])lines.push(`- ${c.capability_id}: ${c.objective} [findings=${(c.finding_ids||[]).length}]`);
  for(const t of r.tasks||[])lines.push(`- task ${t.task_id}: ${t.state}, scope=${t.scope_state}, verification=${t.verification}, evidence_current=${t.evidence_current}`);
  for(const row of r.residual_verified_findings||[])lines.push(`- ${row.capability_id}: ${row.findings.length} residual findings despite verification; inspect these before declaring the capability complete`);
  for(const k of r.interpretations|| (r.interpretation?[r.interpretation]:[]))lines.push(`- ${k.id}: ${k.review_status}/${k.state} ${k.text||k.reason||''}`);
  for(const c of r.candidates||[])lines.push(`- ${c.candidate.candidate_id}: ${c.status}; registered=false; executable=false`);
  if(r.handoff)lines.push(`Task: ${r.handoff.task_id}`,r.handoff.instructions||'');
  if(r.verification_status)lines.push(`Verification: ${r.verification_status}; capability satisfied=${r.capability_satisfied}`);
  if(r.candidate)lines.push(`Candidate: ${r.candidate.id||r.candidate.candidate_id}`);
  if(r.knowledge?.candidate)lines.push(`Knowledge candidate: ${r.knowledge.candidate.id} (UNREVIEWED)`);
  if(r.knowledge?.ok===false)lines.push(`Knowledge write-back failed: ${r.knowledge.reason}`);
  if(r.items)lines.push(...r.items.map(i=>`- ${i.id}: ${i.text}`),`Recall: ${r.items.length}, omitted=${r.omitted.length}, truncated=${r.truncated}`);
  if(r.review_status)lines.push(`Review: ${r.id} ${r.review_status}; interpretation, not fact`);
  if(typeof r.next==='string')lines.push(`Next: ${r.next}`);
  if(r.warnings?.length)lines.push(`Warnings: ${r.warnings.join(', ')}`);
  return lines.join('\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=runProductCli();
  console.log(process.argv.includes('--json')?JSON.stringify(result,null,2):formatProductResult(result));
  process.exitCode=!result.ok?1:result.status==='VERIFICATION_FAILED'?2:0;
}
