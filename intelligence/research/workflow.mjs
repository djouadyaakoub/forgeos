/**
 * Solution research — schema, cache, workflow (READ/ANALYZE/COMPARE only)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getProjectDir } from '../../policy/project-adapter.mjs';

const DEFAULT_TTL_DAYS = 90;
const FAST_CHANGING_TTL_DAYS = 14;

export function validateResearchResult(result) {
  const errors = [];
  const r = result?.research_result || result;
  if (!r) return { valid: false, errors: ['missing research_result'] };

  if (!r.problem) errors.push('missing problem');
  if (!Array.isArray(r.constraints)) errors.push('constraints must be array');
  if (!Array.isArray(r.candidates)) errors.push('candidates must be array');

  for (const [i, c] of (r.candidates || []).entries()) {
    if (!c.name) errors.push(`candidate[${i}]: missing name`);
    if (!c.source) errors.push(`candidate[${i}]: missing source`);
    if (c.relevance_score != null && (c.relevance_score < 0 || c.relevance_score > 1)) {
      errors.push(`candidate[${i}]: relevance_score must be 0-1`);
    }
  }

  if (!r.recommendation?.selected && r.candidates?.length) {
    errors.push('recommendation.selected required when candidates exist');
  }

  return { valid: errors.length === 0, errors };
}

export function createResearchResult(problem, constraints = [], candidates = [], recommendation = {}, confidence = 0.5) {
  return {
    research_result: {
      problem,
      constraints,
      candidates: candidates.map((c) => ({
        name: c.name || '',
        source: c.source || '',
        architecture: c.architecture || '',
        relevance_score: c.relevance_score ?? 0,
        maturity: c.maturity ?? 0,
        maintenance: c.maintenance ?? 0,
        security_notes: c.security_notes || [],
        licensing: c.licensing || '',
        pros: c.pros || [],
        cons: c.cons || [],
      })),
      recommendation: {
        selected: recommendation.selected || '',
        reason: recommendation.reason || '',
        alternatives: recommendation.alternatives || [],
      },
      confidence,
      created_at: new Date().toISOString(),
    },
  };
}

function researchDir(projectDir = getProjectDir()) {
  return path.join(projectDir, 'docs/agents/research');
}

function cacheKey(problem) {
  return crypto.createHash('sha256').update(String(problem).toLowerCase().trim()).digest('hex').slice(0, 16);
}

export function getResearchCachePath(problem, projectDir = getProjectDir()) {
  return path.join(researchDir(projectDir), `${cacheKey(problem)}.yaml`);
}

export function readResearchCache(problem, projectDir = getProjectDir()) {
  const file = getResearchCachePath(problem, projectDir);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const dateMatch = raw.match(/cached_at:\s*(\S+)/);
    const ttlMatch = raw.match(/ttl_days:\s*(\d+)/);
    const cachedAt = dateMatch ? new Date(dateMatch[1]) : new Date(0);
    const ttlDays = ttlMatch ? Number(ttlMatch[1]) : DEFAULT_TTL_DAYS;
    const ageMs = Date.now() - cachedAt.getTime();
    if (ageMs > ttlDays * 86400000) return { expired: true, path: file };
    return { expired: false, path: file, raw };
  } catch {
    return null;
  }
}

export function writeResearchCache(problem, result, projectDir = getProjectDir(), options = {}) {
  const dir = researchDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const ttl = options.fastChanging ? FAST_CHANGING_TTL_DAYS : DEFAULT_TTL_DAYS;
  const file = getResearchCachePath(problem, projectDir);
  const header = `problem: "${String(problem).replace(/"/g, '\\"')}"\ncached_at: ${new Date().toISOString()}\nttl_days: ${ttl}\n`;
  const body = JSON.stringify(result, null, 2);
  fs.writeFileSync(file, `${header}\n---\n${body}`, 'utf8');
  return file;
}

export function planResearchWorkflow(problem, technologies = []) {
  return {
    workflow: [
      { step: 'extract_requirements', status: 'pending', input: problem },
      { step: 'identify_technologies', status: 'pending', technologies },
      { step: 'search_solutions', status: 'pending', prefer: ['official_documentation', 'standards', 'mature_open_source'] },
      { step: 'compare_architectures', status: 'pending' },
      { step: 'analyze_tradeoffs', status: 'pending' },
      { step: 'recommend', status: 'pending' },
    ],
    mode: 'READ_ANALYZE_COMPARE',
    prohibited: ['COPY_RANDOM_CODE', 'AUTO_IMPLEMENT_WITHOUT_REVIEW'],
  };
}
