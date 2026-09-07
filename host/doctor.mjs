/** Deterministic project diagnostics, never live vendor detection. */
import { discoverHosts, selectHost, getHostExecutionAdapter, discoverHostCapabilities } from './discovery.mjs';
import { validateHostCapabilityDescriptor } from './adapter.mjs';
import { readHostConfiguration } from './configuration.mjs';
import { instructionStatus } from './preparation.mjs';
import { projectRoot } from './project-files.mjs';

export function diagnoseHost(options = {}) {
  try {
    const root = projectRoot(options.project_dir || process.cwd());
    const selection = selectHost({ ...options, project_dir: root });
    const config = readHostConfiguration(root);
    const instructions = instructionStatus(root, selection.host_id);
    const descriptor = selection.supported ? discoverHostCapabilities({ host_id: selection.host_id }) : null;
    const validation = validateHostCapabilityDescriptor(descriptor);
    const adapter = selection.supported ? getHostExecutionAdapter(selection.host_id) : null;
    return { ok: selection.ok && selection.supported && instructions.ok,
      phase: 'host_doctor', project_dir: root.replace(/\\/g, '/'), selection,
      inventory: discoverHosts({ ...options, project_dir: root }).hosts,
      configuration: { configured_host: config.configured_host, source: config.source, valid: config.ok },
      adapter_available: !!adapter && validation.valid, contract: descriptor, validation,
      instructions, handoff_ready: selection.supported && validation.valid && config.ok && instructions.ready,
      readiness_scope: 'adapter_and_instruction_preparation_only_not_task_approval',
      live_verified: false, installed: null, health: adapter?.health() || { status: 'unknown' },
      reason: !selection.ok ? selection.reason : !selection.supported ? 'unsupported_host' : !instructions.ok ? instructions.reason : null,
      warnings: ['interactive_only', 'live_session_unverified',
        ...(!config.configured_host ? ['host_not_configured'] : []), ...(!instructions.ready ? ['instructions_not_ready'] : []),
        ...(instructions.warnings || [])] };
  } catch (e) { return { ok: false, phase: 'host_doctor', reason: e.message, live_verified: false }; }
}
