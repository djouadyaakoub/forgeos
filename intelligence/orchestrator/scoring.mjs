/**
 * Agent capability discovery and specialist scoring
 */
export function discoverCapabilities(registry = {}, projectAdapter = {}) {
  const global = registry.capabilities || [];
  const project = projectAdapter.capabilities || [];
  const merged = new Map();

  for (const cap of global) {
    const id = typeof cap === 'string' ? cap : cap.id;
    merged.set(id, { ...cap, id, source: 'global' });
  }
  for (const cap of project) {
    const id = typeof cap === 'string' ? cap.replace(/^id:\s*/, '') : cap.id;
    const existing = merged.get(id) || {};
    merged.set(id, {
      ...existing,
      ...cap,
      id,
      specialist_ids: cap.agent ? [cap.agent] : (cap.specialist_ids || existing.specialist_ids),
      source: 'project',
    });
  }

  return [...merged.values()];
}

export function discoverAgents(policy = {}, projectAdapter = {}) {
  const agents = { ...(policy.agents || {}) };
  const projectAgents = projectAdapter.agents || projectAdapter.specialists || {};
  for (const [id, cfg] of Object.entries(projectAgents)) {
    agents[id] = { ...agents[id], ...cfg, id, source: agents[id] ? 'merged' : 'project' };
  }
  return agents;
}

export function scoreSpecialist(agentId, agentConfig, request = {}, context = {}) {
  const text = `${request.objective || ''} ${request.description || ''}`.toLowerCase();
  const paths = request.paths || [];
  let score = 0;
  const factors = [];

  const writable = agentConfig.paths_writable || agentConfig.paths_owned || [];
  for (const p of paths) {
    if (pathMatches(p, writable)) {
      score += 30;
      factors.push('path_ownership');
      break;
    }
  }

  const domains = context.domains || request.domains || [];
  const agentDomains = agentConfig.domains || [];
  for (const d of domains) {
    if (agentDomains.includes(d) || agentId.includes(d)) {
      score += 20;
      factors.push('domain_match');
    }
  }

  if (context.required_capability) {
    const capAgents = context.capability_agents?.[context.required_capability] || [];
    if (capAgents.includes(agentId)) {
      score += 40;
      factors.push('capability_match');
    }
  }

  if (text.includes(agentId.replace(/-/g, ' ')) || text.includes(agentId)) {
    score += 15;
    factors.push('name_relevance');
  }

  const risk = context.risk?.level || 'LOW';
  const tierMax = agentConfig.approval_tier_max ?? 2;
  if (risk === 'CRITICAL' && tierMax < 2) {
    score -= 50;
    factors.push('risk_incompatible');
  }

  return { agent_id: agentId, score, factors, policy_authoritative: true };
}

function pathMatches(filePath, patterns = []) {
  const p = String(filePath).replace(/\\/g, '/');
  return patterns.some((pat) => {
    const regex = String(pat)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`^${regex}$`, 'i').test(p);
  });
}

export function selectBestSpecialist(candidates = [], request = {}, context = {}) {
  if (!candidates.length) return null;
  const scored = candidates
    .map((c) => {
      const id = typeof c === 'string' ? c : c.id || c.agent_id;
      const cfg = typeof c === 'object' ? c : { id };
      return scoreSpecialist(id, cfg, request, context);
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0] : scored[0] || null;
}

export function findSpecialistsForDomains(agents, domains = [], capabilities = []) {
  const result = [];
  for (const [id, cfg] of Object.entries(agents)) {
    const agentDomains = cfg.domains || [];
    if (domains.some((d) => agentDomains.includes(d) || id.includes(d))) {
      result.push({ id, ...cfg });
    }
  }
  for (const cap of capabilities) {
    const capDomains = cap.domains || [];
    if (domains.some((d) => capDomains.includes(d))) {
      for (const sid of cap.specialist_ids || (cap.agent ? [cap.agent] : [])) {
        if (sid && !result.find((r) => r.id === sid)) {
          result.push({ id: sid, from_capability: cap.id });
        }
      }
    }
  }
  return result;
}
