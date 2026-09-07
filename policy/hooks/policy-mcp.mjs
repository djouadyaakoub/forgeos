#!/usr/bin/env node
import { evaluateMcp, hookOutput, readStdinJson } from '../authority.mjs';
import { initHookRuntime } from '../runtime.mjs';

try {
  const input = readStdinJson();
  initHookRuntime(input);
  const decision = evaluateMcp(input.mcp_server_name || '', input.tool_name || '');
  process.stdout.write(hookOutput(decision));
  process.exit(decision.permission === 'deny' ? 2 : 0);
} catch (err) {
  process.stderr.write(String(err));
  process.stdout.write(
    JSON.stringify({
      permission: 'deny',
      authority: 'forgeos',
      user_message: 'MCP policy hook error — call blocked (fail closed).',
      agent_message: `policy-mcp error: ${err.message}`,
    })
  );
  process.exit(2);
}
