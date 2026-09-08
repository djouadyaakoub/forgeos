/** Executable identity only. This is not a Task Scope or authorization check. */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isExecutedAsMain(moduleUrl, argv1 = process.argv[1]) {
  if (typeof argv1 !== 'string' || !argv1) return false;
  try {
    const entry = fs.realpathSync(argv1);
    const modulePath = fs.realpathSync(fileURLToPath(moduleUrl));
    if (entry === modulePath) return true;
    // realpath may retain input casing on a case-insensitive filesystem.
    // Compare file identity rather than lowercasing paths (unsafe on case-sensitive volumes).
    const a = fs.statSync(entry, { bigint: true });
    const b = fs.statSync(modulePath, { bigint: true });
    return a.isFile() && b.isFile() && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}
