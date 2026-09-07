/** Product facade: current assessment -> explicit selection -> governed interactive handoff -> verification. */
import fs from 'node:fs';
import { createDocumentationContract, documentationCapability } from './documentation-verification.mjs';
import { selectWorkflow } from './workflow-profile.mjs';
import { projectRoot, projectPath } from '../../host/project-files.mjs';
import { diagnoseHost } from '../../host/doctor.mjs';
import { runProjectAssessment } from '../assessment/engine.mjs';
import { listKnowledge, retrieveKnowledge, writeKnowledgeCandidate } from '../assessment/knowledge-lifecycle.mjs';
import { createHostHandoff, loadHostHandoff, validateHostHandoff, requestHostTaskVerification } from './host-handoff.mjs';
import { evaluateTaskScope, evaluateScopedTaskTool } from '../../policy/authority.mjs';
import { checkScopeContainment } from '../../policy/task-scope.mjs';

export function projectStatus(options = {}) {
  return statusRequest(options).result;
}
function statusRequest(options = {}) {
  const root = projectRoot(options.project_dir || process.cwd());
  const host = diagnoseHost({ project_dir: root, host_id: options.host_id });
  if (!host.ok) return {result:{ ok: false, status: 'BLOCKED', reason: host.reason, host }};
  const assessment = runProjectAssessment({ project_dir: root, persist: false, skip_knowledge:true, host_id: host.selection.host_id });
  const knowledge = listKnowledge(root);
  const directory = projectPath(root, 'docs/project/tasks'), tasks = [];
  const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter(x => x.endsWith('.handoff.json')).sort() : [];
  for (const file of files.slice(0,256)) {
    const id = file.slice(0,-'.handoff.json'.length), handoff = loadHostHandoff(root,id);
    const valid = validateHostHandoff(handoff,{project_dir:root,expected_task_id:id,expected_host_id:host.selection.host_id});
    const canvas = assessment.canvas.items.find(i => i.capability_id === handoff.capability_id);
    tasks.push({ task_id:id, capability_id:handoff.capability_id, scope_state:valid.ok?'CURRENT':'STALE',
      reasons:valid.reasons, verification:handoff.verification_status || 'UNKNOWN',
      evidence_current: !!handoff.last_evidence_id && canvas?.last_evidence_id === handoff.last_evidence_id && canvas.state === 'SATISFIED',
      state:!valid.ok?'STALE':handoff.verification_status === 'PASS' ? 'VERIFIED_HISTORY':'INTERACTIVE_REQUIRED' });
  }
  const choices = assessment.canvas.task_candidates.map(t=>({ task_id:t.task_id,capability_id:t.capability_id,
    objective:t.objective,finding_ids:t.finding_ids,operation_id:t.operation_id }));
  const residual = assessment.assessments.filter(r=>r.assessment.state==='SATISFIED' && r.assessment.evidence?.length)
    .map(r=>({capability_id:r.binding.id,findings:r.assessment.evidence,reason:'verification_strategy_does_not_prove_all_findings_resolved'}));
  const unreviewed = knowledge.interpretations.filter(r=>r.review_status === 'UNREVIEWED' && r.state === 'CURRENT').length;
  const pending = tasks.filter(t=>t.state === 'INTERACTIVE_REQUIRED');
  const next = pending.length ? {status:pending.length===1?'INTERACTIVE_REQUIRED':'AMBIGUOUS_NEXT_ACTION',tasks:pending}
    : unreviewed ? {status:'KNOWLEDGE_REVIEW_REQUIRED',count:unreviewed}
      : {status:choices.length===0?'NO_ACTIONABLE_TASK':choices.length===1?'READY':'AMBIGUOUS_NEXT_ACTION',choices};
  return {assessment, result:{ ok:true,status:host.handoff_ready?'PARTIAL':'BLOCKED',project:assessment.project,host,
    pi:{freshness:'COLLECTED_NOW',fingerprint:knowledge.facts.fingerprint,coverage:knowledge.facts.analysis_scope.status},
    assessment_state:'ASSESSED_NOW',canvas:assessment.canvas.summary,
    findings:assessment.assessments.flatMap(r=>(r.assessment.evidence||[]).map(f=>({...f,capability_id:r.binding.id}))),
    choices,tasks,tasks_omitted:Math.max(0,files.length-256),residual_verified_findings:residual,
    knowledge:knowledge.interpretations.map(r=>({id:r.id,state:r.state,review_status:r.review_status})),next,
    warnings:[...host.warnings,'assessment_and_interpretation_are_not_approval',...(residual.length?['verified_capabilities_have_residual_findings']:[]),...(files.length>256?['task_inventory_truncated']:[])] }};
}
export function nextProjectAction(options = {}) {
  if (options.policy_decision === 'deny' || options.policy_decision?.permission === 'deny') return {ok:false,status:'POLICY_DENIED',reason:'policy_deny'};
  const request = statusRequest(options), status = request.result;
  if (!status.ok) return status;
  if (!options.capability_id && !options.finding_id && !options.task_id && status.next.status !== 'READY') return {ok:true,...status.next};
  const matches = status.choices.filter(t=>(!options.capability_id||t.capability_id===options.capability_id)
    && (!options.finding_id||t.finding_ids.includes(options.finding_id)) && (!options.task_id||t.task_id===options.task_id));
  if (matches.length!==1) return {ok:true,status:matches.length?'AMBIGUOUS_NEXT_ACTION':'NO_ACTIONABLE_TASK',choices:matches};
  if (!options.prepare) return {ok:true,status:'READY',choice:matches[0],next:'Use next --prepare with this capability; it prepares only, never executes.'};
  if (!status.host.handoff_ready) return {ok:false,status:'BLOCKED',reason:'host_instructions_not_ready'};
  const root = projectRoot(options.project_dir || process.cwd());
  const assessment = request.assessment;
  let candidate = assessment.canvas.task_candidates.find(t=>t.task_id===matches[0].task_id);
  if (!candidate) return {ok:false,status:'STALE',reason:'assessment_selection_changed'};
  const workflow = selectWorkflow({risk:candidate.risk,action:'write',paths:options.path?[options.path]:candidate.affected_files,
    capability_id:candidate.capability_id,requested:options.workflow});
  // Built-in completion floor cannot be downgraded by mutable capability metadata.
  if (documentationCapability(candidate.capability_id)) {
    // New semantic task IDs preserve legacy handoffs and bind the selected finding state.
    const initial = createDocumentationContract(root,candidate.task_id,candidate.capability_id,options.path);
    candidate = {...candidate, task_id:`${candidate.task_id}-semantic-${initial.baseline_fingerprint}`,task_scope:undefined};
    candidate.verification_contract = {...initial,task_id:candidate.task_id};
    candidate.verification_strategy = 'finding_resolution';
    candidate.finding_ids = initial.targets.map(t=>t.id);
    candidate.affected_files = [...new Set(initial.targets.map(t=>t.path))];
  }
  const prior = loadHostHandoff(root,candidate.task_id);
  if (prior) {
    if (prior.policy_context?.permission === 'deny') return {ok:false,status:'POLICY_DENIED',reason:'policy_deny'};
    const valid = validateHostHandoff(prior,{project_dir:root,expected_task_id:candidate.task_id,expected_host_id:status.host.selection.host_id});
    return {ok:valid.ok,status:valid.ok?'INTERACTIVE_REQUIRED':'STALE',handoff:valid.ok?prior:null,
      reason:'existing_handoff_preserved_use_task_regeneration_for_changed_scope',validation:valid,
      knowledge:valid.ok?retrieveKnowledge(root,{task_id:prior.task_id,capability_id:prior.capability_id,paths:prior.relevant_evidence?.affected_files||[]}):null};
  }
  if (options.path) {
    if (!candidate.task_scope) {
      const rebound = evaluateTaskScope(candidate,root);
      if (!rebound.ok) return {ok:false,status:'POLICY_DENIED',reason:rebound.reason};
      candidate.task_scope = rebound.scope;
    }
    const check = checkScopeContainment(candidate.task_scope,{project_dir:root,action_class:'write',path:options.path});
    if (!check.ok) return {ok:false,status:'POLICY_DENIED',reason:check.reason};
    candidate = {...candidate,task_scope:undefined,policy_context:{...candidate.policy_context,allowed_paths:[options.path]},affected_files:[options.path]};
  }
  const scope = evaluateTaskScope(candidate,root);
  if (!scope.ok) return {ok:false,status:'POLICY_DENIED',reason:scope.reason};
  candidate.task_scope = scope.scope;
  const planned = options.path ? [options.path] : (candidate.operation?.writes || []).map(w=>w.path);
  const decisions = planned.map(p=>evaluateScopedTaskTool(candidate,root,{tool_name:'Write',tool_input:{path:p}}));
  if (decisions.some(d=>d.permission==='deny')) return {ok:false,status:'POLICY_DENIED',decisions};
  const handoff = createHostHandoff({project_dir:root,candidate,host_id:status.host.selection.host_id,persist:true,
    policy_context:{permission:planned.length?'allow':null}});
  if (!handoff.ok) return {...handoff,status:'BLOCKED'};
  return { ...handoff,workflow,status:'INTERACTIVE_REQUIRED',policy:{scope,decisions,approval:'per_action_still_required_no_blanket_authorization'},
    knowledge:retrieveKnowledge(root,{task_id:candidate.task_id,capability_id:candidate.capability_id,paths:candidate.affected_files}),
    next:`complete --task ${candidate.task_id} --changed <path> after the interactive action` };
}
export function completeProjectTask(options = {}) {
  const root = projectRoot(options.project_dir || process.cwd());
  const prior = loadHostHandoff(root,options.task_id);
  const candidate = prior && {task_id:prior.task_id,capability_id:prior.capability_id,operation_id:prior.operation_id,
    task_scope:prior.task_scope,expected_effects:prior.expected_effects,permitted_action_classes:prior.task_scope?.permitted_action_classes,
    policy_context:{agent_id:prior.constraints?.agent_id,project_id:prior.task_scope?.project_id,
      allowed_paths:prior.constraints?.allowed_paths,forbidden_paths:prior.constraints?.forbidden_paths}};
  const changed = options.changed_paths || [];
  if (!Array.isArray(changed) || changed.length > 64) throw new Error('invalid_changed_paths');
  for (const p of changed) {
    if (!candidate) return {ok:false,status:'BLOCKED',reason:'handoff_missing'};
    const decision = evaluateScopedTaskTool(candidate,root,{tool_name:'Write',tool_input:{path:p}});
    if (decision.permission !== 'allow') return {ok:false,status:'POLICY_DENIED',reason:decision.reason};
  }
  const result = requestHostTaskVerification({project_dir:root,task_id:options.task_id,host_id:options.host_id,
    observed_changed_paths:options.changed_paths,persist:true,policy_decision:options.policy_decision});
  if (!result.ok) return {...result,status:result.reason==='policy_deny'?'POLICY_DENIED':'BLOCKED'};
  // Failure must be as bounded as success; do not emit every unrelated candidate to the host.
  const observedCanvas = result.canvas_after;
  if (observedCanvas) result.canvas_after = {summary:observedCanvas.summary,derived:true,authoritative:false,
    task_capability:observedCanvas.items.find(i=>i.capability_id===result.capability_id)};
  if (result.verification_status !== 'PASS') return {...result,status:'VERIFICATION_FAILED'};
  let knowledge = null;
  if (options.learning) {
    try {
      const refs = options.changed_paths?.length ? options.changed_paths : result.handoff.verification_presence;
      knowledge = writeKnowledgeCandidate(root,{text:options.learning,source:options.host_id || result.handoff.host.host_id,
        evidence_refs:refs,capability_id:result.capability_id,lineage:{task_id:result.task_id,capability_id:result.capability_id,
          evidence_id:result.evidence.evidence_id,execution_id:result.evidence.execution_id,scope_fingerprint:result.handoff.task_scope.fingerprint}});
    } catch(e) { knowledge = {ok:false,reason:e.message}; }
  }
  const taskCanvas = result.canvas_after?.task_capability;
  return {...result,canvas_after:result.canvas_after?{summary:result.canvas_after.summary,derived:true,authoritative:false,
    task_capability:{id:result.capability_id,state:taskCanvas?.state,last_evidence_id:taskCanvas?.last_evidence_id}}:null,
    status:knowledge?.ok?'KNOWLEDGE_REVIEW_REQUIRED':'READY',knowledge,
    warnings:knowledge && !knowledge.ok?['verification_passed_but_knowledge_writeback_failed']:[],
    next:knowledge?.ok?'Review candidate explicitly; verification has not accepted it.':'Use status for current Canvas and next work.'};
}
