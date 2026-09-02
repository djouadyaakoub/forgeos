/**
 * Universal structure/change risk classification
 */
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const CRITICAL_PATTERNS = [
  /migration/i,
  /auth/i,
  /secret/i,
  /ledger/i,
  /financial/i,
  /tenant/i,
  /production/i,
  /deploy/i,
  /password/i,
  /credential/i,
];

const HIGH_PATTERNS = [
  /public[/_-]?api/i,
  /interface/i,
  /boundary/i,
  /package[/_-]?root/i,
  /module[/_-]?boundary/i,
];

export function classifyStructureRisk(change = {}) {
  const from = String(change.from || '');
  const to = String(change.to || '');
  const reason = String(change.reason || '');
  const combined = `${from} ${to} ${reason}`.toLowerCase();
  const action = String(change.action || 'move').toLowerCase();

  if (CRITICAL_PATTERNS.some((p) => p.test(combined))) {
    return { level: 'CRITICAL', auto_execute: false, requires_approval: true };
  }

  if (action === 'rename' && !change.imports_affected && !change.tests_affected) {
    return { level: 'LOW', auto_execute: true, requires_approval: false };
  }

  if (action === 'create_directory') {
    return { level: 'LOW', auto_execute: true, requires_approval: false };
  }

  if (HIGH_PATTERNS.some((p) => p.test(combined))) {
    return { level: 'HIGH', auto_execute: false, requires_approval: true };
  }

  const imports = Number(change.imports_affected || 0);
  const tests = Number(change.tests_affected || 0);

  if (imports > 5 || tests > 3) {
    return { level: 'HIGH', auto_execute: false, requires_approval: true };
  }

  if (imports > 0 || tests > 0 || action === 'move') {
    return { level: 'MEDIUM', auto_execute: false, requires_approval: true };
  }

  return { level: 'LOW', auto_execute: true, requires_approval: false };
}

export function maxRiskLevel(levels = []) {
  const order = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  return levels.reduce((max, l) => (order[l] > order[max] ? l : max), 'LOW');
}

export function canAutoExecute(riskLevel) {
  return riskLevel === 'LOW';
}
