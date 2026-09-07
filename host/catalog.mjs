/** Canonical product identities. Bootstrap inventory and backend registry are separate. */
export const HOST_CATALOG = Object.freeze({
  codex: Object.freeze({ id: 'codex', name: 'Codex', instruction_file: 'AGENTS.md' }),
  cursor: Object.freeze({ id: 'cursor', name: 'Cursor', instruction_file: 'AGENTS.md' }),
  'claude-code': Object.freeze({ id: 'claude-code', name: 'Claude Code', instruction_file: 'CLAUDE.md' }),
});
export const PRODUCT_HOST_IDS = Object.freeze(Object.keys(HOST_CATALOG));
export function isProductHost(id) {
  return typeof id === 'string' && Object.hasOwn(HOST_CATALOG, id);
}
export function getProductHost(id) { return isProductHost(id) ? HOST_CATALOG[id] : null; }
