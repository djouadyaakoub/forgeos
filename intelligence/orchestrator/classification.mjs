/**
 * Task classification — multi-label task classes
 */
export const TASK_CLASSES = {
  BUG_FIX: 'BUG_FIX',
  FEATURE: 'FEATURE',
  REFACTOR: 'REFACTOR',
  ARCHITECTURE_CHANGE: 'ARCHITECTURE_CHANGE',
  SECURITY: 'SECURITY',
  PERFORMANCE: 'PERFORMANCE',
  DATABASE: 'DATABASE',
  MIGRATION: 'MIGRATION',
  DOCUMENTATION: 'DOCUMENTATION',
  PROJECT_ORGANIZATION: 'PROJECT_ORGANIZATION',
  RESEARCH: 'RESEARCH',
  DEPENDENCY: 'DEPENDENCY',
  RELEASE: 'RELEASE',
  INVESTIGATION: 'INVESTIGATION',
};

const CLASS_PATTERNS = [
  { class: TASK_CLASSES.BUG_FIX, patterns: [/bug\b/i, /fix\b/i, /broken/i, /regression/i, /reproduce/i, /error/i] },
  { class: TASK_CLASSES.FEATURE, patterns: [/add\b/i, /implement/i, /build\b/i, /create\b/i, /new feature/i, /design an? /i] },
  { class: TASK_CLASSES.REFACTOR, patterns: [/refactor/i, /restructure/i, /cleanup/i, /extract module/i, /simplify/i] },
  { class: TASK_CLASSES.ARCHITECTURE_CHANGE, patterns: [/architecture/i, /subsystem/i, /new service/i, /boundary/i, /adr/i] },
  { class: TASK_CLASSES.SECURITY, patterns: [/security/i, /auth/i, /permission/i, /tenant/i, /credential/i, /secret/i] },
  { class: TASK_CLASSES.PERFORMANCE, patterns: [/performance/i, /latency/i, /slow/i, /optimize/i, /profile/i, /benchmark/i] },
  { class: TASK_CLASSES.DATABASE, patterns: [/database/i, /\bdb\b/i, /schema/i, /sql/i, /postgres/i, /supabase/i] },
  { class: TASK_CLASSES.MIGRATION, patterns: [/migration/i, /migrate/i, /alter table/i] },
  { class: TASK_CLASSES.DOCUMENTATION, patterns: [/document/i, /readme/i, /docs sync/i, /update docs/i] },
  { class: TASK_CLASSES.PROJECT_ORGANIZATION, patterns: [/organize/i, /structure audit/i, /codebase organization/i, /move files/i] },
  { class: TASK_CLASSES.RESEARCH, patterns: [/research/i, /evaluate technology/i, /compare libraries/i, /which (library|framework)/i, /technology x/i] },
  { class: TASK_CLASSES.DEPENDENCY, patterns: [/dependency/i, /package\.json/i, /go\.mod/i, /upgrade library/i] },
  { class: TASK_CLASSES.RELEASE, patterns: [/release/i, /deploy readiness/i, /go live/i, /ship\b/i] },
  { class: TASK_CLASSES.INVESTIGATION, patterns: [/explain\b/i, /why does/i, /how does/i, /understand/i, /investigate/i, /analyze without modifying/i] },
];

export function classifyTaskClasses(request = {}) {
  const text = `${request.objective || ''} ${request.description || ''} ${(request.paths || []).join(' ')}`;
  const classes = new Set();
  const signals = request.signals || {};
  const projectSignals = request.project_signals || {};

  for (const { class: cls, patterns } of CLASS_PATTERNS) {
    if (patterns.some((p) => p.test(text))) classes.add(cls);
  }

  if (request.domains?.includes('security') || request.sensitive_flags?.length) {
    classes.add(TASK_CLASSES.SECURITY);
  }
  if (request.domains?.includes('database') || signals.database_impact) {
    classes.add(TASK_CLASSES.DATABASE);
  }
  if (projectSignals.force_classes) {
    for (const c of projectSignals.force_classes) classes.add(c);
  }

  if (classes.size === 0) {
    if (/implement|add|build/i.test(text)) classes.add(TASK_CLASSES.FEATURE);
    else classes.add(TASK_CLASSES.INVESTIGATION);
  }

  return {
    task_classes: [...classes],
    primary: pickPrimary([...classes], text),
  };
}

function pickPrimary(classes, text) {
  const priority = [
    TASK_CLASSES.RELEASE,
    TASK_CLASSES.MIGRATION,
    TASK_CLASSES.SECURITY,
    TASK_CLASSES.RESEARCH,
    TASK_CLASSES.PROJECT_ORGANIZATION,
    TASK_CLASSES.REFACTOR,
    TASK_CLASSES.ARCHITECTURE_CHANGE,
    TASK_CLASSES.BUG_FIX,
    TASK_CLASSES.INVESTIGATION,
    TASK_CLASSES.FEATURE,
  ];
  for (const p of priority) {
    if (classes.includes(p)) return p;
  }
  return classes[0];
}

export function taskClassLabel(classes = []) {
  return classes.join(' + ');
}
