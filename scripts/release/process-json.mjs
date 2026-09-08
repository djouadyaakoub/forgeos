/** Require useful JSON from a subprocess; preserve diagnostic output on failure. */
export function parseProcessJson(result, label, expectedStatus = 0) {
  const detail = { label, exit_code: result.status, signal: result.signal || null,
    error: result.error?.message || null, stdout: result.stdout || '', stderr: result.stderr || '' };
  const reject = reason => { throw new Error(JSON.stringify({ reason, ...detail })); };
  if (result.error || result.status !== expectedStatus) reject('subprocess_failed');
  if (!detail.stdout.trim()) reject('empty_json_stdout');
  try { return JSON.parse(detail.stdout); }
  catch { reject('invalid_json_stdout'); }
}
