/** Tests write only to their own temporary fixture tree; repository fixtures stay read-only. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function temporaryFixtures(source) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'forgeos-fixtures-'));
  const root = path.join(temp,'fixtures');
  fs.cpSync(source,root,{recursive:true,filter:p=>!/(?:\.backup-\d+$|[\\/]docs[\\/]project(?:[\\/]|$))/.test(p)});
  process.once('exit',()=>fs.rmSync(temp,{recursive:true,force:true}));
  return root;
}
