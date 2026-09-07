#!/usr/bin/env node
import { evaluateShell, hookOutput, readStdinJson } from '../authority.mjs';
import { initHookRuntime } from '../runtime.mjs';

try {
  const input = readStdinJson();
  initHookRuntime(input);
  const decision = evaluateShell(input.command);
  process.stdout.write(hookOutput(decision));
  process.exit(decision.permission === 'deny' ? 2 : 0);
} catch (err) {
  process.stderr.write(String(err));
  process.stdout.write(
    JSON.stringify({
      permission: 'deny',
      authority: 'forgeos',
      user_message: 'Shell policy hook error — command blocked (fail closed).',
      agent_message: `policy-shell error: ${err.message}`,
    })
  );
  process.exit(2);
}
