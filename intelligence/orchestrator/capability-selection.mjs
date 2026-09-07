/**
 * Capability selection — Stage 11
 *
 * Selects capabilities from the registered ForgeOS catalog only.
 * Never invents capability IDs. Assessment informs remediation need;
 * user intent determines desired state. Does not authorize or execute.
 */
import { loadCapabilityBindings, getCapabilityBinding } from '../capability/binding.mjs';

const ACTIONABLE_STATES = new Set(['PARTIAL', 'NEEDS_IMPROVEMENT', 'NOT_CONFIGURED']);
const SKIP_REMEDIATION_STATES = new Set(['SATISFIED', 'NOT_APPLICABLE']);

function assessmentMap(assessment) {
  const map = new Map();
  const rows = assessment?.assessments || [];
  for (const row of rows) {
    const id = row.binding?.id || row.assessment?.capability_id;
    if (id) map.set(id, row.assessment || row);
  }
  if (assessment?.canvas?.items) {
    for (const item of assessment.canvas.items) {
      if (item.capability_id && !map.has(item.capability_id)) {
        map.set(item.capability_id, item);
      }
    }
  }
  return map;
}

/**
 * @param {object} input
 * @param {object} input.intent
 * @param {object} [input.assessment]
 * @param {object} [input.bindings]
 * @param {string[]} [input.extra_capability_ids] — must still exist in registry
 */
export function selectCapabilities(input = {}) {
  const intent = input.intent || {};
  const bindings = input.bindings || loadCapabilityBindings(input.binding_options);
  const byId = new Map((bindings.capabilities || []).map((c) => [c.id, c]));
  const states = assessmentMap(input.assessment);
  const selected = [];
  const skipped = [];
  const unresolved = [];
  const rationale = [];

  const requested = unique([
    ...(intent.requested_capabilities || []),
    ...(input.extra_capability_ids || []),
  ]);

  for (const id of requested) {
    if (!byId.has(id)) {
      unresolved.push({
        status: 'UNRESOLVED',
        capability_id: id,
        reason: 'no_registered_capability',
      });
      rationale.push({
        capability_id: id,
        action: 'unresolved',
        reason: 'Capability id is not present in the ForgeOS capability registry',
      });
      continue;
    }

    const binding = byId.get(id);
    const assessment = states.get(id);
    const state = assessment?.state || 'UNKNOWN';

    if (
      SKIP_REMEDIATION_STATES.has(state)
      && intent.explicit_change_request !== true
      && input.force_include !== true
    ) {
      skipped.push({
        capability_id: id,
        state,
        reason: 'already_satisfied_or_not_applicable',
      });
      rationale.push({
        capability_id: id,
        action: 'skip',
        reason: `Assessment state is ${state}; no remediation unless user explicitly requested change`,
        assessment_state: state,
      });
      continue;
    }

    selected.push({
      capability_id: id,
      binding,
      assessment_state: state,
      assessment_severity: assessment?.severity || binding.default_severity,
      requires: [...(binding.requires || [])],
      reason: stateReason(state, intent),
    });
    rationale.push({
      capability_id: id,
      action: 'select',
      reason: stateReason(state, intent),
      assessment_state: state,
    });
  }

  // Expand declared requires when selected (still must be registered)
  const expanded = expandRequires(selected, byId, states, intent, rationale);

  return {
    selected: dedupeSelected(expanded.selected),
    skipped,
    unresolved: [...unresolved, ...expanded.unresolved],
    rationale,
    registry_count: bindings.capabilities?.length || 0,
  };
}

function expandRequires(selected, byId, states, intent, rationale) {
  const out = [...selected];
  const unresolved = [];
  const seen = new Set(out.map((s) => s.capability_id));
  const queue = [...out];

  while (queue.length) {
    const current = queue.shift();
    for (const req of current.requires || []) {
      if (seen.has(req)) continue;
      if (!byId.has(req)) {
        unresolved.push({
          status: 'UNRESOLVED',
          capability_id: req,
          reason: 'unresolved_dependency',
          required_by: current.capability_id,
        });
        rationale.push({
          capability_id: req,
          action: 'unresolved_dependency',
          reason: `Required by ${current.capability_id} but not registered`,
        });
        continue;
      }
      const binding = byId.get(req);
      const assessment = states.get(req);
      const state = assessment?.state || 'UNKNOWN';
      // Dependencies needed for ordering are included even if SATISFIED
      // so the plan remains inspectable; task generation may mark them non-remediation.
      const entry = {
        capability_id: req,
        binding,
        assessment_state: state,
        assessment_severity: assessment?.severity || binding.default_severity,
        requires: [...(binding.requires || [])],
        reason: `Required dependency of ${current.capability_id}`,
        dependency_of: current.capability_id,
        include_for_dependency: true,
      };
      out.push(entry);
      seen.add(req);
      queue.push(entry);
      rationale.push({
        capability_id: req,
        action: 'select_dependency',
        reason: entry.reason,
        assessment_state: state,
      });
    }
  }

  return { selected: out, unresolved };
}

function stateReason(state, intent) {
  if (ACTIONABLE_STATES.has(state)) {
    return `Assessment indicates ${state}; user intent requests improvement`;
  }
  if (state === 'SATISFIED' && intent.explicit_change_request) {
    return 'Capability currently SATISFIED but user explicitly requested change';
  }
  if (state === 'UNKNOWN') {
    return 'User intent matched this registered capability; assessment state UNKNOWN';
  }
  return 'Selected from registered capabilities matching user intent';
}

function unique(list) {
  return [...new Set((list || []).map(String).filter(Boolean))];
}

function dedupeSelected(selected) {
  const map = new Map();
  for (const item of selected) {
    if (!map.has(item.capability_id)) map.set(item.capability_id, item);
  }
  return [...map.values()];
}

export function assertRegisteredCapability(capabilityId, bindings = null) {
  return Boolean(getCapabilityBinding(capabilityId, bindings));
}
