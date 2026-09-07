#!/usr/bin/env node
/** Host list/doctor/config/prepare. Mutating commands require --apply. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverHosts } from '../host/discovery.mjs';
import { diagnoseHost } from '../host/doctor.mjs';
import { readHostConfiguration, setProjectHost } from '../host/configuration.mjs';
import { prepareHostProject } from '../host/preparation.mjs';

export function runForgeOsHostCli(argv = process.argv, options = {}) {
  const args = { project_dir: process.cwd(), apply: false };
  const positional = [];
  let error = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--apply') args.apply = true;
    else if (a === '--help') args.help = true;
    else if (a === '--project' || a === '--host') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) { error = 'missing_option_value'; break; }
      args[a === '--project' ? 'project_dir' : 'host_id'] = argv[++i];
    } else if (a.startsWith('-')) error = 'unsupported_option';
    else positional.push(a);
  }
  const command = positional[0] || 'doctor';
  const expectedArity = command === 'config' ? (positional[1] === 'set' ? 3 : 2) : 1;
  if (positional.length > expectedArity) error = 'unexpected_argument';
  let result;
  if (error) result = { ok: false, reason: error };
  else if (args.help) result = { ok: true, usage: 'node cli/host.mjs list|doctor|status|prepare|config [get|set <host>] [--project <dir>] [--host <id>] [--apply] [--json]',
    note: 'config set and prepare preview by default; --apply writes project-local files only.' };
  else if (command === 'list') { const inventory = discoverHosts(args); result = { ok: inventory.selection.ok, ...inventory }; }
  else if (command === 'doctor' || command === 'status') result = diagnoseHost(args);
  else if (command === 'prepare') result = prepareHostProject(args);
  else if (command === 'config' && positional[1] === 'set') result = setProjectHost(args.project_dir, positional[2], args);
  else if (command === 'config' && (!positional[1] || positional[1] === 'get')) {
    const c = readHostConfiguration(args.project_dir);
    result = { ok: c.ok, source: c.source, configured_host: c.configured_host, reason: c.reason || null };
  } else result = { ok: false, reason: 'unknown_host_command' };
  if (options.print !== false) {
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`ForgeOS host ${command}: ${result.ok ? 'OK' : 'BLOCKED'}\n${JSON.stringify(result, null, 2)}`);
  }
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runForgeOsHostCli();
  process.exitCode = result.ok ? 0 : 1;
}
