/** Codex: same-workspace interactive handoff, not a process launcher. */
import { createInteractiveHostAdapter, discoverInteractiveHostCapabilities } from '../../interactive.mjs';
export const discoverCodexHostCapabilities = () => discoverInteractiveHostCapabilities('codex', 'Codex');
export const createCodexHostAdapter = () => createInteractiveHostAdapter('codex', 'Codex');
