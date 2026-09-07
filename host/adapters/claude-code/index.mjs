/** Claude Code: same-workspace interactive handoff, not a process launcher. */
import { createInteractiveHostAdapter, discoverInteractiveHostCapabilities } from '../../interactive.mjs';
export const discoverClaudeCodeHostCapabilities = () => discoverInteractiveHostCapabilities('claude-code', 'Claude Code');
export const createClaudeCodeHostAdapter = () => createInteractiveHostAdapter('claude-code', 'Claude Code');
