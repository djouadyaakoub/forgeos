#!/usr/bin/env node
import { evaluatePreToolUse, hookOutput, readStdinJson } from '../authority.mjs';
import { initHookRuntime } from '../runtime.mjs';

try {
  const input = readStdinJson();
  initHookRuntime(input);
  const decision = evaluatePreToolUse(input);
  process.stdout.write(hookOutput(decision));
  process.exit(decision.permission === 'deny' ? 2 : 0);
} catch (err) {
  process.stderr.write(String(err));
  process.stdout.write(
    JSON.stringify({
      permission: 'deny',
      authority: 'forgeos',
      user_message: 'Policy hook error — action blocked (fail closed).',
      agent_message: `policy-pre-tool error: ${err.message}`,
    })
  );
  process.exit(2);
}
