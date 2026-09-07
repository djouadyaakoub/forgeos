#!/usr/bin/env node
import { saveSession, readStdinJson } from '../authority.mjs';
import { initHookRuntime } from '../runtime.mjs';
import { POLICY_AUTHORITY } from '../identity.mjs';

try {
  const input = readStdinJson();
  initHookRuntime(input);
  saveSession({
    subagent_type: input.subagent_type || null,
    subagent_id: input.subagent_id || null,
    conversation_id: input.conversation_id || null,
    task_id: input.task_id || null,
    started_at: new Date().toISOString(),
    policy_authority: POLICY_AUTHORITY,
  });
  process.stdout.write(JSON.stringify({ permission: 'allow', authority: POLICY_AUTHORITY }));
  process.exit(0);
} catch (err) {
  // Session binding failure must not invent authorization; still allow start
  // so Cursor can surface the agent, but stamp authority for evidence.
  process.stderr.write(String(err));
  process.stdout.write(
    JSON.stringify({
      permission: 'allow',
      authority: POLICY_AUTHORITY,
      agent_message: `policy-subagent-start warning: ${err.message}`,
    })
  );
  process.exit(0);
}
