/**
 * Knowledge curation — temporary vs permanent, project-scoped only
 */
const FORBIDDEN_PERSIST = [
  /password/i,
  /secret/i,
  /api[_-]?key/i,
  /token/i,
  /bearer/i,
];

const TRANSIENT_PATTERNS = [
  /^trying/i,
  /^maybe/i,
  /temporary/i,
  /debug session/i,
];

export function classifyKnowledge(item) {
  const text = `${item.title || ''} ${item.content || ''}`;
  if (FORBIDDEN_PERSIST.some((p) => p.test(text))) {
    return { classification: 'reject', reason: 'contains_secret_or_credential_pattern' };
  }
  if (TRANSIENT_PATTERNS.some((p) => p.test(text))) {
    return { classification: 'temporary', reason: 'transient_chat_noise' };
  }
  if (item.type === 'architectural_decision') {
    return { classification: 'permanent_candidate', reason: 'architectural_decision', requires_approval: true };
  }
  if (item.recurrence_count >= 3) {
    return { classification: 'permanent_candidate', reason: 'recurring_lesson', confidence: 'high' };
  }
  return { classification: 'temporary', reason: 'default_ephemeral' };
}

export function curateKnowledge(items = []) {
  const results = items.map((item) => ({
    item,
    ...classifyKnowledge(item),
  }));

  return {
    capability: 'knowledge-curation',
    results,
    rules: {
      no_secrets: true,
      no_transient_noise: true,
      no_auto_architecture_change: true,
      architectural_decisions_need_approval: true,
      scope: 'project_only',
    },
    global_persistence: false,
  };
}
