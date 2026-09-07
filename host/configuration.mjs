/** Project preference lives in the existing .agent-os/project.yaml (or JSON fallback). */
import { isProductHost } from './catalog.mjs';
import { readProjectText, writeProjectText } from './project-files.mjs';
import { MANIFEST_PATH, MANIFEST_JSON_PATH } from '../policy/project-adapter.mjs';

export function readHostConfiguration(projectDir) {
  if (!projectDir) return { ok: true, configured_host: null, source: null };
  try {
    let text = readProjectText(projectDir, MANIFEST_PATH);
    let source = MANIFEST_PATH;
    let preferred = null;
    let span = null;
    if (text !== null) {
      // Only this small new block is parsed/written; unrelated YAML remains byte-for-byte intact.
      const lines = text.split(/\r?\n/);
      const starts = lines.flatMap((line, i) => /^\s*(?:host|"host"|'host')\s*:/.test(line) ? [i] : []);
      if (starts.length > 1) throw new Error('ambiguous_host_configuration');
      if (starts.length) {
        const start = starts[0];
        if (!/^host:\s*(?:#.*)?$/.test(lines[start])) throw new Error('invalid_host_configuration');
        let end = start + 1;
        while (end < lines.length && (!lines[end].trim() || /^\s|^#/.test(lines[end]))) end++;
        const values = lines.slice(start + 1, end).filter(l => l.trim() && !l.trim().startsWith('#'));
        if (values.length !== 1) throw new Error('invalid_host_configuration');
        const match = values[0].match(/^  preferred:\s*([a-z-]+)\s*(?:#.*)?$/);
        if (!match) throw new Error('invalid_host_configuration');
        preferred = match[1];
        span = { start, end };
      }
    } else {
      source = MANIFEST_JSON_PATH;
      text = readProjectText(projectDir, source);
      if (text !== null) {
        if ((text.match(/"host"\s*:/g) || []).length > 1) throw new Error('ambiguous_host_configuration');
        const data = JSON.parse(text);
        if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('invalid_project_manifest');
        if (Object.hasOwn(data, 'host')) {
          if (!data.host || Object.keys(data.host).join() !== 'preferred') throw new Error('invalid_host_configuration');
          preferred = data.host.preferred;
        }
      } else source = null;
    }
    if (preferred !== null && !isProductHost(preferred)) throw new Error('invalid_configured_host');
    return { ok: true, configured_host: preferred, source, text, span };
  } catch (e) { return { ok: false, configured_host: null, source: null, reason: e.message }; }
}

export function setProjectHost(projectDir, hostId, options = {}) {
  if (!isProductHost(hostId)) return { ok: false, reason: 'unknown_host' };
  const config = readHostConfiguration(projectDir);
  if (!config.ok) return config; // no overwrite of malformed governance input
  if (!config.source) return { ok: false, reason: 'project_manifest_missing', note: 'Initialize the project manifest first.' };
  try {
    let next;
    if (config.source === MANIFEST_JSON_PATH) {
      next = JSON.stringify({ ...JSON.parse(config.text), host: { preferred: hostId } }, null, 2) + '\n';
    } else {
      const nl = config.text.includes('\r\n') ? '\r\n' : '\n';
      if (config.span) {
        const lines = config.text.split(/\r?\n/);
        // Replace only the preferred value, preserving surrounding comments/blank lines.
        for (let i = config.span.start + 1; i < config.span.end; i++) {
          if (/^  preferred:/.test(lines[i])) lines[i] = lines[i].replace(/^(  preferred:\s*)[a-z-]+/, `$1${hostId}`);
        }
        next = lines.join(nl);
      } else next = config.text + (config.text.endsWith('\n') ? '' : nl) + `host:${nl}  preferred: ${hostId}${nl}`;
    }
    const changed = next !== config.text;
    if (options.apply === true && changed) writeProjectText(projectDir, config.source, next);
    return { ok: true, configured_host: hostId, source: config.source, changed,
      applied: options.apply === true && changed, authority: 'host_preference_only' };
  } catch (e) { return { ok: false, reason: e.message }; }
}
