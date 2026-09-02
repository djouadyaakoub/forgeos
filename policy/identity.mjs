/**
 * ForgeOS product identity — canonical names and legacy aliases
 */
export const PRODUCT_NAME = 'ForgeOS';
export const PRODUCT_DESCRIPTION = 'Universal Development Intelligence Platform';
export const PRODUCT_ID = 'forgeos';
export const PACKAGE_NAME = 'forgeos';

/** Cursor marketplace / plugin cache identifier (adapter-specific) */
export const CURSOR_PLUGIN_ID = 'cursor-agent-os';

export const POLICY_AUTHORITY = 'forgeos';

export const LEGACY_IDENTIFIERS = {
  product_ids: ['cursor-agent-os', 'agent-os', 'universal-agent-os'],
  env_vars: [
    'CURSOR_AGENT_OS_PLUGIN_ROOT',
    'AGENT_OS_PLUGIN_ROOT',
    'AGENT_OS_DEV_ROOT',
    'AGENT_OS_TEST_DIR',
  ],
  manifest_keys: ['agent_os'],
  install_dirs: ['agent-os'],
};

export const ENV = {
  FORGEOS_ROOT: 'FORGEOS_ROOT',
  FORGEOS_DEV_ROOT: 'FORGEOS_DEV_ROOT',
  FORGEOS_TEST_DIR: 'FORGEOS_TEST_DIR',
  /** Legacy — read-only fallback */
  CURSOR_AGENT_OS_PLUGIN_ROOT: 'CURSOR_AGENT_OS_PLUGIN_ROOT',
  AGENT_OS_PLUGIN_ROOT: 'AGENT_OS_PLUGIN_ROOT',
  AGENT_OS_DEV_ROOT: 'AGENT_OS_DEV_ROOT',
  AGENT_OS_TEST_DIR: 'AGENT_OS_TEST_DIR',
  /** Cursor IDE provided — never rename */
  CURSOR_PROJECT_DIR: 'CURSOR_PROJECT_DIR',
  CURSOR_WORKSPACE: 'CURSOR_WORKSPACE',
};

export const CLI_COMMANDS = {
  update_status: 'forgeos update status',
  legacy_update_status: 'agent-os update status',
};

export const INSTALL_DIR_NAMES = {
  primary: 'forge-os',
  legacy: 'agent-os',
};

export function resolveRootFromEnv() {
  return (
    process.env[ENV.FORGEOS_ROOT]
    || process.env[ENV.CURSOR_AGENT_OS_PLUGIN_ROOT]
    || process.env[ENV.AGENT_OS_PLUGIN_ROOT]
    || null
  );
}

export function resolveDevRootFromEnv() {
  return process.env[ENV.FORGEOS_DEV_ROOT] || process.env[ENV.AGENT_OS_DEV_ROOT] || null;
}

export function resolveTestDirFromEnv() {
  return process.env[ENV.FORGEOS_TEST_DIR] || process.env[ENV.AGENT_OS_TEST_DIR] || null;
}
