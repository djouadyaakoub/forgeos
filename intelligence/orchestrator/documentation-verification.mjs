/** Bounded finding-resolution contract. Content checks are deliberately heuristic, not prose truth. */
import { detectDocumentationDrift } from '../documentation/drift.mjs';
import { collectProjectFacts, fingerprintText } from '../assessment/facts.mjs';
import { projectRoot, readProjectText } from '../../host/project-files.mjs';

export const documentationCapability = id => ['documentation-sync', 'documentation-drift'].includes(id);
export const documentationFindingId = finding => fingerprintText(JSON.stringify([finding.type, finding.path, finding.issue || finding.message || finding.path]));
export function documentationState(root) {
  const facts = collectProjectFacts(root);
  const knowledge = facts.project_intelligence?.knowledge || {};
  const findings = detectDocumentationDrift(root, knowledge).drift_items;
  const paths = [...new Set([knowledge.stack || 'docs/STACK.md', knowledge.agents || 'AGENTS.md', 'README.md'])].sort();
  const documents = paths.map(p => ({path:p, content:readProjectText(root,p)}));
  return {facts, findings, fingerprint:fingerprintText(JSON.stringify({documents,findings}))};
}
export function createDocumentationContract(root, taskId, capabilityId, targetPath) {
  const state = documentationState(root);
  const targets = state.findings.filter(f => !targetPath || f.path === targetPath)
    .map(f => ({id:documentationFindingId(f), path:f.path, type:f.type}));
  return {version:1, strategy:'finding_resolution', workspace:projectRoot(root).replace(/\\/g,'/'),
    task_id:taskId, capability_id:capabilityId, configuration_fingerprint:state.facts.project_intelligence_fingerprint,
    baseline_fingerprint:state.fingerprint, targets};
}
export function verifyDocumentationContract(root, candidate) {
  const c = candidate.verification_contract;
  if (!c || c.version !== 1 || c.strategy !== 'finding_resolution' || !documentationCapability(candidate.capability_id)
    || c.task_id !== candidate.task_id || c.capability_id !== candidate.capability_id
    || c.workspace !== projectRoot(root).replace(/\\/g,'/') || !c.baseline_fingerprint
    || !Array.isArray(c.targets) || !c.targets.length || c.targets.length > 64) {
    return [{id:'finding_contract',result:'UNKNOWN',reason:'missing_or_invalid_finding_contract'}];
  }
  const current = documentationState(root);
  if (c.configuration_fingerprint !== current.facts.project_intelligence_fingerprint)
    return [{id:'finding_contract',result:'UNKNOWN',reason:'configuration_changed_replan_required'}];
  return c.targets.map(t => {
    const text = readProjectText(root,t.path);
    const remaining = current.findings.filter(f => f.path === t.path);
    return {id:`finding:${t.id}`, path:t.path, result:typeof text === 'string' && text.trim() && !remaining.length ? 'PASS':'FAIL',
      reason:remaining.length?'target_or_equivalent_violation_remains':text?.trim()?'target_resolved_by_fresh_assessment':'empty_or_missing_document',
      baseline_fingerprint:c.baseline_fingerprint, current_fingerprint:current.fingerprint,
      reassessed:true, remaining_finding_ids:remaining.map(documentationFindingId)};
  });
}
