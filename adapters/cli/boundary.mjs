/**
 * CLI adapter boundary — conceptual commands only (no full CLI implementation)
 */
export const CLI_COMMANDS = {
  project_inspect: 'forgeos project inspect',
  agent_status: 'forgeos agent status',
  update_status: 'forgeos update status',
  release_check: 'forgeos release check',
};

export function getCliBoundary() {
  return {
    id: 'cli',
    implemented: false,
    commands: CLI_COMMANDS,
    note: 'CLI boundary defined; full implementation deferred',
  };
}
