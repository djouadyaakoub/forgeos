/**
 * Structure Plan — reviewable, rollback-capable organization plans
 */
import { classifyStructureRisk, maxRiskLevel, canAutoExecute } from '../risk.mjs';

export function validateStructurePlan(plan) {
  const errors = [];
  if (!plan?.structure_plan) errors.push('missing structure_plan root');
  if (!plan.structure_plan?.project) errors.push('missing project name');
  if (!Array.isArray(plan.structure_plan?.changes)) errors.push('changes must be array');

  const changes = plan.structure_plan?.changes || [];
  for (const [i, ch] of changes.entries()) {
    if (!ch.action) errors.push(`change[${i}]: missing action`);
    if (!ch.from && ch.action !== 'create_directory') errors.push(`change[${i}]: missing from`);
    if (!ch.to && ch.action !== 'delete') errors.push(`change[${i}]: missing to`);
    const risk = classifyStructureRisk(ch);
    ch._computed_risk = risk.level;
    ch._auto_execute = risk.auto_execute;
    if (risk.level === 'CRITICAL') ch._blocked = true;
  }

  const levels = changes.map((c) => c._computed_risk || 'LOW');
  const overall = maxRiskLevel(levels);

  return {
    valid: errors.length === 0,
    errors,
    overall_risk: overall,
    auto_executable: changes.every((c) => canAutoExecute(c._computed_risk || 'LOW')),
    blocked_changes: changes.filter((c) => c._blocked),
    review_required: overall !== 'LOW',
  };
}

export function createStructurePlan(project, changes = [], expectedEffects = [], verification = []) {
  const enriched = changes.map((ch) => {
    const risk = classifyStructureRisk(ch);
    return { ...ch, risk: ch.risk || risk.level.toLowerCase() };
  });

  return {
    structure_plan: {
      project,
      changes: enriched,
      expected_effects: expectedEffects,
      verification: verification.length ? verification : ['build', 'unit_tests', 'import_check'],
      created_at: new Date().toISOString(),
      rollback: {
        strategy: 'reverse_changes_in_order',
        snapshot_recommended: enriched.some((c) => ['MEDIUM', 'HIGH', 'CRITICAL'].includes(String(c.risk).toUpperCase())),
      },
    },
  };
}

export function planToYaml(plan) {
  const lines = ['structure_plan:'];
  const sp = plan.structure_plan;
  lines.push(`  project: ${sp.project}`);
  lines.push('  changes:');
  for (const ch of sp.changes) {
    lines.push(`    - action: ${ch.action}`);
    if (ch.from) lines.push(`      from: ${ch.from}`);
    if (ch.to) lines.push(`      to: ${ch.to}`);
    if (ch.reason) lines.push(`      reason: "${String(ch.reason).replace(/"/g, '\\"')}"`);
    if (ch.risk) lines.push(`      risk: ${ch.risk}`);
    if (ch.owner) lines.push(`      owner: ${ch.owner}`);
    if (ch.imports_affected != null) lines.push(`      imports_affected: ${ch.imports_affected}`);
    if (ch.tests_affected != null) lines.push(`      tests_affected: ${ch.tests_affected}`);
  }
  lines.push('  expected_effects:');
  for (const e of sp.expected_effects || []) lines.push(`    - "${e}"`);
  lines.push('  verification:');
  for (const v of sp.verification || []) lines.push(`    - ${v}`);
  return lines.join('\n');
}
