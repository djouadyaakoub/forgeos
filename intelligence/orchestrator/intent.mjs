/**
 * Intent analysis — Stage 11
 *
 * Converts a natural-language development request into structured intent.
 * Does not invent requirements the user did not provide.
 * Does not execute, authorize, or resolve implementations.
 */
export const INTENT_SCHEMA = 'forgeos-intent';

const EXPLICIT_CHANGE_RE = /\b(rewrite|replace|force\s+update|redo|regenerate|overhaul)\b/i;

const RISK_SIGNAL_RE = /\b(production|prod|deploy|secret|credential|auth|migration|delete|drop|force\s+push)\b/i;

/**
 * Keyword/domain hints mapped to registered capability ids.
 * Selection still validates against the live registry — unknown ids are dropped.
 */
export const INTENT_CAPABILITY_HINTS = Object.freeze([
  {
    capability_id: 'structure-audit',
    patterns: [/\bstructure\b/i, /\borganiz(e|ation|ing)\b/i, /\bclean\s*up\b/i, /\bprofessional(ly)?\b/i, /\blayout\b/i],
  },
  {
    capability_id: 'codebase-organization',
    patterns: [/\borganiz(e|ation|ing)\b/i, /\bclean\s*up\b/i, /\brestructur/i, /\breorganiz/i, /\bprofessional(ly)?\b/i],
  },
  {
    capability_id: 'dead-code-analysis',
    patterns: [/\bdead\s*code\b/i, /\bunused\s+code\b/i, /\bclean\s*up\b/i],
  },
  {
    capability_id: 'dependency-audit',
    patterns: [/\bdependenc/i, /\bnpm\s+audit\b/i, /\bpackage\b/i, /\bclean\s*up\b/i],
  },
  {
    capability_id: 'duplication-analysis',
    patterns: [/\bduplicat/i, /\bredundan/i],
  },
  {
    capability_id: 'documentation-sync',
    patterns: [/\bdocument/i, /\bdocs?\b/i, /\bREADME\b/i, /\bAGENTS\.md\b/i, /\bwrite\s+up\b/i],
  },
  {
    capability_id: 'documentation-drift',
    patterns: [/\bdocument/i, /\bdocs?\b/i, /\bdrift\b/i, /\bREADME\b/i],
  },
  {
    capability_id: 'architecture-guard',
    patterns: [/\barchitecture\b/i, /\blayer\b/i, /\bADR\b/i],
  },
  {
    capability_id: 'cross-cutting-design',
    patterns: [/\barchitecture\b/i, /\bdesign\b/i, /\bownership\b/i],
  },
  {
    capability_id: 'safe-refactor',
    patterns: [/\brefactor\b/i, /\bclean\s*up\b/i],
  },
  {
    capability_id: 'auth-review',
    patterns: [/\bauth\b/i, /\bsecurity\b/i, /\bsecret\b/i, /\btenanc/i],
  },
  {
    capability_id: 'test-coverage-strategy',
    patterns: [/\btest\b/i, /\bcoverage\b/i, /\bqa\b/i],
  },
  {
    capability_id: 'reproduce-bug',
    patterns: [/\bbug\b/i, /\bfix\b/i, /\breproduc/i, /\bdebug\b/i],
  },
  {
    capability_id: 'change-impact',
    patterns: [/\bimpact\b/i, /\brisk\s+of\s+change\b/i],
  },
  {
    capability_id: 'performance-investigation',
    patterns: [/\bperformance\b/i, /\bslow\b/i, /\blatenc/i],
  },
  {
    capability_id: 'release-readiness',
    patterns: [/\brelease\b/i, /\bready\s+to\s+ship\b/i],
  },
  {
    capability_id: 'solution-research',
    patterns: [/\bresearch\b/i, /\binvestigat(e|ion)\b/i, /\bevaluate\b/i],
  },
]);

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function inferScope(text) {
  const scope = [];
  if (/\b(src|source|codebase|structure|folder|director)/i.test(text)) scope.push('structure');
  if (/\b(doc|readme|agents\.md)/i.test(text)) scope.push('docs');
  if (/\b(test|qa|coverage)/i.test(text)) scope.push('testing');
  if (/\b(dependenc|package|npm|cargo|pip)/i.test(text)) scope.push('dependencies');
  if (/\b(security|auth|secret)/i.test(text)) scope.push('security');
  if (/\b(deploy|release|production)/i.test(text)) scope.push('deployment');
  return unique(scope);
}

function inferConstraints(text) {
  const constraints = [];
  if (/\bno\s+deploy/i.test(text)) constraints.push('no_deploy');
  if (/\bread[-\s]?only\b/i.test(text)) constraints.push('read_only');
  if (/\bno\s+delete\b/i.test(text)) constraints.push('no_delete');
  if (/\bwithout\s+changing\s+source\b/i.test(text)) constraints.push('no_source_mutation');
  return constraints;
}

function inferUrgency(text) {
  if (/\b(urgent|asap|immediately|critical)\b/i.test(text)) return 'high';
  if (/\b(when\s+possible|low\s+priority|eventually)\b/i.test(text)) return 'low';
  return null;
}

function matchCapabilityHints(text) {
  const matched = [];
  for (const hint of INTENT_CAPABILITY_HINTS) {
    if (hint.patterns.some((re) => re.test(text))) {
      matched.push(hint.capability_id);
    }
  }
  return unique(matched);
}

/**
 * Analyze a user request into structured intent.
 * @param {string|object} request
 * @param {object} [context]
 */
export function analyzeIntent(request, context = {}) {
  const text = typeof request === 'string'
    ? request
    : String(request?.text || request?.request || '');
  const trimmed = text.trim();
  const explicitChange = EXPLICIT_CHANGE_RE.test(trimmed);
  const requestedCapabilityHints = matchCapabilityHints(trimmed);
  const unresolvedQuestions = [];

  if (!trimmed) {
    unresolvedQuestions.push({
      code: 'empty_request',
      question: 'What development outcome should ForgeOS plan for?',
    });
  } else if (requestedCapabilityHints.length === 0 && !context.allow_empty_hints) {
    unresolvedQuestions.push({
      code: 'target_scope_unclear',
      question: 'Which project areas should change (structure, docs, tests, security, etc.)?',
    });
  }

  const riskSignals = [];
  if (RISK_SIGNAL_RE.test(trimmed)) riskSignals.push('sensitive_keywords');

  return {
    schema: INTENT_SCHEMA,
    schema_version: 1,
    raw_request: trimmed,
    objective: trimmed || null,
    requested_outcome: trimmed
      ? summarizeOutcome(trimmed, requestedCapabilityHints)
      : null,
    scope: inferScope(trimmed),
    constraints: inferConstraints(trimmed),
    urgency: inferUrgency(trimmed),
    risk_signals: riskSignals,
    affected_areas: inferScope(trimmed),
    requested_capabilities: requestedCapabilityHints,
    explicit_change_request: explicitChange,
    unknown_fields: buildUnknownFields(trimmed, requestedCapabilityHints),
    unresolved_questions: unresolvedQuestions,
  };
}

function summarizeOutcome(text, capabilityHints) {
  if (capabilityHints.includes('codebase-organization') || capabilityHints.includes('structure-audit')) {
    if (capabilityHints.some((c) => c.startsWith('documentation'))) {
      return 'Improve project organization and documentation quality.';
    }
    return 'Improve project structure and maintainability.';
  }
  if (capabilityHints.some((c) => c.startsWith('documentation'))) {
    return 'Improve project documentation alignment with reality.';
  }
  if (capabilityHints.includes('auth-review')) {
    return 'Review security and authentication posture.';
  }
  return `Address requested development outcome: ${text.slice(0, 120)}`;
}

function buildUnknownFields(text, hints) {
  const unknown = [];
  if (!inferUrgency(text)) unknown.push('urgency');
  if (!hints.length) unknown.push('requested_capabilities');
  return unknown;
}

export function normalizeIntentFingerprint(intent) {
  return JSON.stringify({
    objective: intent?.objective || '',
    requested_capabilities: [...(intent?.requested_capabilities || [])].sort(),
    scope: [...(intent?.scope || [])].sort(),
    constraints: [...(intent?.constraints || [])].sort(),
    explicit_change_request: intent?.explicit_change_request === true,
  });
}
