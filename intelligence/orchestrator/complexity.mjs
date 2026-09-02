/**
 * Complexity estimation — separate from risk
 */
const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export function estimateComplexity(request = {}, context = {}) {
  const text = `${request.objective || ''} ${request.description || ''}`.toLowerCase();
  const signals = request.signals || {};
  const projectSignals = context.project_signals || request.project_signals || {};
  const factors = {
    files_affected: signals.files_affected ?? (request.paths?.length || 0),
    domains_affected: signals.domains_affected ?? (request.domains?.length || 0),
    components_affected: signals.components_affected ?? 0,
    database_impact: signals.database_impact ?? /database|migration|schema|sql/i.test(text),
    api_impact: signals.api_impact ?? /api|endpoint|contract|interface/i.test(text),
    security_sensitivity: signals.security_sensitivity ?? /auth|tenant|secret|permission/i.test(text),
    deployment_impact: signals.deployment_impact ?? /deploy|production|release/i.test(text),
    architecture_impact: signals.architecture_impact ?? /architecture|subsystem|boundary/i.test(text),
    cross_agent_dependencies: signals.cross_agent_dependencies ?? (request.domains?.length > 2),
    unknowns: signals.unknowns ?? /unknown|uncertain|evaluate|research/i.test(text),
  };

  if (projectSignals.complexity_boost) {
    factors.architecture_impact = true;
    factors.cross_agent_dependencies = true;
  }

  let score = 0;
  if (factors.files_affected <= 2 && !factors.database_impact) score += 1;
  else if (factors.files_affected <= 5) score += 2;
  else score += 3;

  if (factors.domains_affected <= 1) score += 0;
  else if (factors.domains_affected <= 2) score += 1;
  else score += 2;

  if (factors.components_affected > 1) score += 1;
  if (factors.database_impact) score += 1;
  if (factors.api_impact) score += 1;
  if (factors.architecture_impact) score += 2;
  if (factors.cross_agent_dependencies) score += 2;
  if (factors.unknowns) score += 1;
  if (factors.deployment_impact) score += 1;

  if (request.complexity === 'high' || request.complexity === 'HIGH') score += 2;
  if (request.complexity === 'low' || request.complexity === 'LOW') score = Math.max(0, score - 2);

  let level = 'LOW';
  if (score <= 2) level = 'LOW';
  else if (score <= 5) level = 'MEDIUM';
  else if (score <= 8) level = 'HIGH';
  else level = 'CRITICAL';

  if (/explain\b|how does|why does/i.test(text) && score <= 3) level = 'LOW';

  return { level, score, factors };
}

export { LEVELS as COMPLEXITY_LEVELS };
