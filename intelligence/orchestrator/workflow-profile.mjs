/** Selection changes preparation cost, never Policy, scope, approval or verification authority. */
const profiles = ['MINIMAL','SCOPED','FULL'];
export function selectWorkflow(input = {}) {
  const paths = input.paths || [], reasons = [];
  let rank = 0;
  const raise = (value, reason) => {rank = Math.max(rank,value);reasons.push(reason);};
  if (!['read','write'].includes(input.action)) raise(2,'unknown_or_external_action');
  if (!['low','medium','high'].includes(input.risk)) raise(2,'unknown_risk');
  if (input.risk === 'high') raise(2,'high_risk');
  if (input.risk === 'medium') raise(1,'medium_risk');
  if (!Array.isArray(paths) || !paths.length) raise(2,'unknown_expected_paths');
  else {
    if (paths.length > 1) raise(1,'multiple_expected_paths');
    if (paths.length > 8) raise(2,'large_scope');
    if (paths.some(p=> typeof p !== 'string' || /(^|[\\/])(policy|runtime|host|bootstrap|\.agent-os|\.git|\.github)([\\/]|$)|package(?:-lock)?\.json$|AGENTS\.md$|CLAUDE\.md$/i.test(p))) raise(2,'protected_boundary');
  }
  if (/security|migration|architecture|release|deploy/i.test(input.capability_id || '') || input.production || input.cross_domain) raise(2,'cross_domain_or_sensitive_capability');
  const requested = input.requested?.toUpperCase();
  if (requested && !profiles.includes(requested)) throw new Error('invalid_workflow');
  if (requested) raise(profiles.indexOf(requested),'explicit_governance_floor');
  if (!reasons.length) reasons.push('bounded_single_file_low_risk');
  return {profile:profiles[rank],reasons,requested:requested||null,downgrade_allowed:false,
    authority:'preparation_only_policy_scope_approval_and_verification_unchanged'};
}
