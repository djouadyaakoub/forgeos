#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { getProjectDir } from '../project-adapter.mjs';
import { readStdinJson } from '../authority.mjs';
import { initHookRuntime } from '../runtime.mjs';
import { POLICY_AUTHORITY } from '../identity.mjs';

try {
  const input = readStdinJson();
  initHookRuntime(input);
  const auditPath = path.join(getProjectDir(), '.cursor/policy/audit.log');
  const entry = {
    type: 'post_tool_use',
    tool_name: input.tool_name,
    authority: POLICY_AUTHORITY,
    timestamp: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.appendFileSync(auditPath, JSON.stringify(entry) + '\n');
  process.stdout.write(JSON.stringify({ permission: 'allow', authority: POLICY_AUTHORITY }));
  process.exit(0);
} catch {
  process.stdout.write(JSON.stringify({ permission: 'allow', authority: POLICY_AUTHORITY }));
  process.exit(0);
}
