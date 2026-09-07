/**
 * Stage 16 — OpenHands Live E2E validation gate tests
 *
 * Never invents LIVE_PASS. When env is unset, asserts LIVE_BLOCKED_ENVIRONMENT.
 */
import assert from 'node:assert/strict';
import { runStage16LiveGate, LIVE_CLASSIFICATIONS } from '../runtime/adapters/openhands/stage16-live-gate.mjs';
import { resolveCapabilityOperation } from '../intelligence/capability/resolver.mjs';

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    return false;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;
console.log('Stage 16 OpenHands Live E2E Validation Gate\n');

if (
  test('classification vocabulary fixed', () => {
    assert.ok(LIVE_CLASSIFICATIONS.includes('LIVE_PASS'));
    assert.ok(LIVE_CLASSIFICATIONS.includes('LIVE_BLOCKED_ENVIRONMENT'));
    assert.ok(LIVE_CLASSIFICATIONS.includes('LIVE_RUNTIME_FAILURE'));
    assert.ok(LIVE_CLASSIFICATIONS.includes('LIVE_VERIFICATION_FAILURE'));
    assert.ok(LIVE_CLASSIFICATIONS.includes('LIVE_POLICY_FAILURE'));
    assert.ok(LIVE_CLASSIFICATIONS.includes('LIVE_PACKAGING_FAILURE'));
  })
)
  passed++;
else failed++;

if (
  test('resolver still maps create-missing-project-docs → oss_backed/openhands', () => {
    const r = resolveCapabilityOperation({
      operation_id: 'create-missing-project-docs',
      preference: 'oss_backed',
      runtime_backend_id: 'openhands',
      host_context: { host_id: 'cli', capabilities: ['read'] },
    });
    assert.equal(r.implementation_type, 'oss_backed');
    assert.equal(r.implementation_id, 'openhands');
    assert.equal(r.execution_boundary, 'resolver_does_not_execute');
  })
)
  passed++;
else failed++;

if (
  await testAsync('live gate — BLOCKED or real LIVE_PASS (never fake)', async () => {
    const gate = await runStage16LiveGate({});
    assert.ok(LIVE_CLASSIFICATIONS.includes(gate.classification), gate.classification);
    assert.equal(gate.env_vars.OPENHANDS_AGENT_SERVER_URL === 'configured'
      || gate.env_vars.OPENHANDS_AGENT_SERVER_URL === 'not_configured', true);

    // Never invent secrets in report object
    const dumped = JSON.stringify(gate);
    assert.equal(/sk-[A-Za-z0-9]{8,}/.test(dumped), false);

    if (gate.environment.status !== 'READY' || !gate.environment.live_capable) {
      assert.equal(gate.stage16, 'BLOCKED');
      assert.equal(gate.classification, 'LIVE_BLOCKED_ENVIRONMENT');
      assert.equal(gate.live_e2e, 'NOT_RUN');
      assert.equal(gate.real_execution, 'NOT_RUN');
      assert.notEqual(gate.classification, 'LIVE_PASS');
      console.log(`        LIVE GATE: BLOCKED (${gate.reason})`);
      console.log(`        classification: ${gate.classification}`);
      console.log(`        Agent Server URL: ${gate.env_vars.OPENHANDS_AGENT_SERVER_URL}`);
      console.log(`        Provider: ${gate.env_vars.OPENHANDS_LLM_API_KEY}`);
      console.log(`        Model: ${gate.env_vars.OPENHANDS_MODEL}`);
    } else {
      console.log(`        LIVE GATE: ${gate.stage16}`);
      console.log(`        classification: ${gate.classification}`);
      assert.ok(['PASS', 'BLOCKED'].includes(gate.stage16));
      if (gate.stage16 === 'PASS') {
        assert.equal(gate.classification, 'LIVE_PASS');
        assert.equal(gate.live_e2e, 'PASS');
        assert.equal(gate.real_execution, 'PASS');
        assert.equal(gate.forgeos_verification, 'PASS');
      }
    }
  })
)
  passed++;
else failed++;

console.log(`\nStage 16 Live Gate: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
