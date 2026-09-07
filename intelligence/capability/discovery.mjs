/** Inert candidate metadata. Deliberately has no registry, resolver, runtime, import or network edge. */
import { projectRoot } from '../../host/project-files.mjs';
import { safeId, compactText, readLocalStore, updateLocalStore } from '../assessment/local-store.mjs';
export const SOURCE_KINDS = Object.freeze(['OSS_LIBRARY','OSS_METHODOLOGY','API','MCP','MODEL_PROVIDER','OPTIONAL_RUNTIME','HOST_CAPABILITY']);
const STORE = '.agent-os/discovery/candidates.json';
const fields = ['candidate_id','source_kind','name','description','source','url','revision','license','discovered_at','expires_at','claims','requirements','provenance'];
export function normalizeCandidate(input) {
  if (!input || Object.keys(input).some(k => !fields.includes(k))) throw new Error('unknown_candidate_field');
  safeId(input.candidate_id);
  if (!SOURCE_KINDS.includes(input.source_kind)) throw new Error('invalid_source_kind');
  const url = new URL(input.url);
  if (url.protocol !== 'https:' || url.username || url.password || input.url.length > 2048) throw new Error('unsafe_candidate_url');
  const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
  if (!date(input.discovered_at) || !date(input.expires_at) || Date.parse(input.expires_at) <= Date.parse(input.discovered_at)) throw new Error('invalid_candidate_dates');
  if (!Array.isArray(input.claims) || !input.claims.length || input.claims.length > 32) throw new Error('invalid_claims');
  const req = input.requirements;
  if (!req || Object.keys(req).length !== 3 || ['network','docker','external_runtime'].some(k => ![true,false,null].includes(req[k]))) throw new Error('invalid_requirements');
  if (!input.provenance || Object.keys(input.provenance).some(k => !['observer','evidence'].includes(k))) throw new Error('invalid_candidate_provenance');
  return { candidate_id: input.candidate_id, source_kind: input.source_kind, name: compactText(input.name,120),
    description: compactText(input.description,1000), source: compactText(input.source,200), url: url.href,
    revision: input.revision === null ? null : compactText(input.revision,120), license: input.license === null ? null : compactText(input.license,120),
    discovered_at: input.discovered_at, expires_at: input.expires_at, claims: [...new Set(input.claims.map(x => compactText(x,200)))].sort(),
    requirements: { network: req.network, docker: req.docker, external_runtime: req.external_runtime },
    provenance: { observer: compactText(input.provenance.observer,120), evidence: compactText(input.provenance.evidence,1000) } };
}
export function assessDiscoveryCandidate(input, options = {}) {
  const candidate = normalizeCandidate(input), now = options.now ?? Date.now();
  if (!Number.isFinite(now)) throw new Error('invalid_assessment_time');
  const unknown = !candidate.license || !candidate.revision || Object.values(candidate.requirements).includes(null);
  const licenseSupported = ['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','ISC'].includes(candidate.license);
  const status = Date.parse(candidate.discovered_at) > now ? 'UNKNOWN'
    : Date.parse(candidate.expires_at) <= now ? 'STALE'
      : unknown ? 'UNKNOWN' : !licenseSupported ? 'REJECTED' : 'ELIGIBLE';
  return { candidate, assessment_status: 'ASSESSED', status, assessed_at: new Date(now).toISOString(),
    rationale: status === 'ELIGIBLE' ? 'metadata_complete_for_manual_registration_review_not_verified_claims' : 'stale_future_incomplete_or_license_requires_separate_review',
    trust: 'untrusted_metadata', registered: false, available: false, executable: false, policy_approved: false };
}
export function discoverCandidate(projectDir, input) {
  const candidate = normalizeCandidate(input), root = projectRoot(projectDir);
  updateLocalStore(root, STORE, rows => {
    if (rows.some(r => r.candidate?.candidate_id === candidate.candidate_id)) throw new Error('duplicate_candidate');
    return [...rows, { workspace: root.replace(/\\/g,'/'), candidate }];
  });
  return { ok: true, candidate, status: 'DISCOVERED', registered: false, executable: false };
}
export function listDiscovery(projectDir, options = {}) {
  const root = projectRoot(projectDir), ids = new Set();
  return readLocalStore(root, STORE).map(row => {
    if (row.workspace !== root.replace(/\\/g,'/') || Object.keys(row).some(k => !['workspace','candidate'].includes(k))) throw new Error('candidate_workspace_or_store_invalid');
    const candidate = normalizeCandidate(row.candidate);
    if (ids.has(candidate.candidate_id)) throw new Error('duplicate_candidate'); ids.add(candidate.candidate_id);
    return options.assess ? assessDiscoveryCandidate(candidate, options)
      : { candidate, status: Date.parse(candidate.expires_at) <= (options.now ?? Date.now()) ? 'STALE' : 'DISCOVERED', registered: false, executable: false };
  });
}
