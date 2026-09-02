#!/usr/bin/env node
/**
 * Phase 20 — Universal Project Intelligence tests
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractProjectAdapter, summarizeAdapter } from '../bootstrap/adapter-extraction.mjs';
import { buildCanonicalProjectProfile } from '../bootstrap/project-intelligence.mjs';
import { resolveEvidenceSets } from '../bootstrap/evidence-resolver.mjs';
import { normalizeCapability } from '../bootstrap/capability-normalizer.mjs';
import { discoverCiDeployments } from '../intelligence/deployment/ci-discovery.mjs';
import { discoverDeploymentTargets } from '../intelligence/deployment/discovery.mjs';
import { planDevelopmentIntelligenceWorkflow } from '../intelligence/orchestrator/planner.mjs';
import { detectDeploymentIntent } from '../intelligence/orchestrator/deployment-intent.mjs';
import { detectActionType, isReadOnlyAction } from '../intelligence/orchestrator/action-risk.mjs';
import { shouldTriggerResearch, shouldTriggerStructure, shouldTriggerDeployment } from '../intelligence/orchestrator/triggers.mjs';
import { readResearchCache, writeResearchCache } from '../intelligence/research/workflow.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(ROOT, 'fixtures');
const SPEED_FLEXY = process.env.SPEED_FLEXY_PATH || 'C:/Apps/speed-flexy-server';
const SIM = 'C:/Apps/sim-activation';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function writeFixture(rel, files) {
  const base = path.join(FIXTURES, rel);
  fs.mkdirSync(base, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(base, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return base;
}

console.log('Phase 20 — Universal Project Intelligence\n');

console.log('--- Capability normalization ---');
test('inferred capability carries confidence', () => {
  const cap = normalizeCapability({ id: 'mobile', source: 'docs/agents/SPECIALISTS.md', inferred: true, confidence: 0.7 });
  assert(cap.inferred === true, 'inferred');
  assert(cap.confidence === 0.7, 'confidence');
});

console.log('\n--- Fixture matrix ---');
const FIX_B = writeFixture('intelligence-matrix/specialists-only', {
  'docs/agents/SPECIALISTS.md': `# Specialists
| backend api signals | Backend/API | [task-playbooks/02-backend-api.md](task-playbooks/02-backend-api.md) |
| mobile flutter | Mobile | [task-playbooks/04-mobile.md](task-playbooks/04-mobile.md) |
`,
  'docs/agents/task-playbooks/02-backend-api.md': '# Backend API\n',
  'docs/agents/task-playbooks/04-mobile.md': '# Mobile\n',
});

const FIX_C = writeFixture('intelligence-matrix/playbook-only', {
  'docs/agents/task-playbooks/01-architect.md': '# Architect\n',
  'docs/agents/task-playbooks/07-qa-bugfix.md': '# QA\n',
});

const FIX_G = writeFixture('intelligence-matrix/ci-only-deploy', {
  '.github/workflows/deploy.yml': `name: Deploy Admin Web
on: push
jobs:
  deploy:
    steps:
      - run: npx wrangler pages deploy dist --project-name test-admin
`,
});

test('B — SPECIALISTS.md yields capabilities', () => {
  const { adapter } = extractProjectAdapter(FIX_B);
  assert(adapter.capabilities.length >= 2, `caps ${adapter.capabilities.length}`);
  assert(adapter.capabilities.every((c) => c.inferred), 'inferred');
});

test('C — playbook-only yields agents', () => {
  const { adapter } = extractProjectAdapter(FIX_C);
  assert(Object.keys(adapter.agents).length >= 2, 'agents');
});

test('G — CI workflow discovers cloudflare-pages', () => {
  const d = discoverDeploymentTargets({ project_dir: FIX_G, project_adapter: {} });
  const providers = d.targets.map((t) => t.deployment_target.provider);
  assert(providers.includes('cloudflare-pages'), `providers: ${providers.join(',')}`);
});

console.log('\n--- Evidence resolver ---');
test('conflict detection for capability agent mismatch', () => {
  const r = resolveEvidenceSets({
    capabilities: [
      [{ id: 'x', agent: 'a', source: 'r1', source_type: 'project_registry', confidence: 0.95 }],
      [{ id: 'x', agent: 'b', source: 'r2', source_type: 'agents_md', confidence: 0.7 }],
    ],
    agents: [],
    ownership: [],
    verification: [],
  });
  assert(r.contradictions.some((c) => c.type === 'capability_agent_conflict'), 'conflict');
});

console.log('\n--- Action risk & deployment intent ---');
test('read-only analyze has LOW action risk', () => {
  const req = { objective: 'Analyze deployment setup. Do not modify files.' };
  assert(isReadOnlyAction(req), 'read only');
  const intent = detectDeploymentIntent(req);
  assert(intent.requested === false, 'no execution intent');
  assert(intent.discovery_only === true, 'discovery only');
});

test('planner read-only investigation skips deployment execution', () => {
  const plan = planDevelopmentIntelligenceWorkflow(
    { objective: 'Analyze the project components and deployment targets. Do not modify files.' },
  );
  const names = plan.development_workflow.stages.map((s) => s.name);
  assert(!names.includes('deployment-execute'), `stages: ${names.join(',')}`);
  assert(!names.includes('deployment-build'), 'no build');
});

test('deployment intent required for execution workflow', () => {
  const plan = planDevelopmentIntelligenceWorkflow({ objective: 'Deploy to production now' });
  assert(plan.deployment_intent.requested === true, 'intent');
  const names = plan.development_workflow.stages.map((s) => s.name);
  assert(names.includes('deployment-execute'), 'has execute');
});

console.log('\n--- Trigger refinement ---');
test('research not triggered by production word alone', () => {
  const r = shouldTriggerResearch({ objective: 'Explain production configuration' });
  assert(!r.required, r.reason);
});

test('structure not triggered for pure analysis', () => {
  const s = shouldTriggerStructure({ objective: 'Analyze project structure without modifying files' });
  assert(!s.required, s.reason);
});

console.log('\n--- Research isolation ---');
const RA = writeFixture('intelligence-matrix/project-a-research', {});
const RB = writeFixture('intelligence-matrix/project-b-research', {});
writeResearchCache('test topic', { research_result: { conclusion: 'A only' } }, RA);
writeResearchCache('test topic', { research_result: { conclusion: 'B only' } }, RB);
test('project A cache not returned for project B', () => {
  const a = readResearchCache('test topic', RA);
  const b = readResearchCache('test topic', RB);
  const aBody = JSON.parse(a.raw.split('---')[1]);
  const bBody = JSON.parse(b.raw.split('---')[1]);
  assert(aBody.research_result.conclusion === 'A only', 'A cache');
  assert(bBody.research_result.conclusion === 'B only', 'B cache');
});

console.log('\n--- Security boundaries ---');
test('inferred capability cannot be VERIFIED confidence', () => {
  const cap = normalizeCapability({ id: 'x', inferred: true, confidence: 0.7 });
  assert(cap.confidence < 0.9, 'not verified level');
});

console.log('\n--- Live project read-only ---');
if (fs.existsSync(SIM)) {
  test('sim-activation capabilities > 0', () => {
    const profile = buildCanonicalProjectProfile(SIM);
    assert(profile.capabilities.length > 0, `caps ${profile.capabilities.length}`);
  });
  test('sim-activation CI cloudflare discovery', () => {
    const d = discoverDeploymentTargets({ project_dir: SIM, project_adapter: {} });
    const providers = d.targets.map((t) => t.deployment_target.provider);
    assert(providers.includes('cloudflare-pages') || providers.includes('supabase'), providers.join(','));
  });
}

if (fs.existsSync(SPEED_FLEXY)) {
  test('Speed Flexy registry capabilities preserved', () => {
    const before = summarizeAdapter(extractProjectAdapter(SPEED_FLEXY).adapter);
    assert(before.capability_count >= 30, `caps ${before.capability_count}`);
    assert(before.agent_count >= 10, `agents ${before.agent_count}`);
  });
}

console.log(`\n${'─'.repeat(40)}\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${passed + failed})\n`);
process.exit(failed > 0 ? 1 : 0);
