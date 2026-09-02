#!/usr/bin/env node
import { saveSession, readStdinJson } from '../engine.mjs';
import { initHookRuntime } from '../runtime.mjs';

try {
  const input = readStdinJson();
  initHookRuntime(input);
  saveSession({
    subagent_type: input.subagent_type || null,
    subagent_id: input.subagent_id || null,
    conversation_id: input.conversation_id || null,
    task_id: input.task_id || null,
    started_at: new Date().toISOString(),
  });
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
} catch (err) {
  process.stderr.write(String(err));
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
}
