/**
 * Project fact discovery for assessment — read-only, no execution.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { discoverProject, loadProjectManifest } from '../../policy/project-adapter.mjs';
import { walkProject } from '../structure/analyzer.mjs';

const SOURCE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs',
  '.java', '.kt', '.swift', '.cs', '.rb', '.php', '.dart',
]);

function exists(dir, rel) {
  return fs.existsSync(path.join(dir, rel));
}

export function fingerprintText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

export function collectProjectFacts(projectDir, options = {}) {
  const root = path.resolve(projectDir || process.cwd());
  const discovery = options.discovery || discoverProject(root);
  const manifestWrap = options.manifest || loadProjectManifest(root);
  const pi = manifestWrap?.data || discovery.manifest || null;
  const initialized = discovery.mode === 'INITIALIZED' || !!pi;

  let files = [];
  let dirs = [];
  if (fs.existsSync(root)) {
    const walked = walkProject(root, { maxFiles: options.maxFiles || 4000 });
    files = walked.files;
    dirs = walked.dirs;
  }

  const hasSource = files.some((f) => SOURCE_EXT.has(path.extname(f).toLowerCase()));
  const hasTests = files.some((f) =>
    /(^|\/)tests?\//.test(f) || /\.(test|spec)\./i.test(f)
  );
  const hasDocs = exists(root, 'docs') || exists(root, 'README.md') || exists(root, 'AGENTS.md');
  const hasAgentsMd = exists(root, 'AGENTS.md');
  const hasReadme = exists(root, 'README.md');
  const hasStackDoc = exists(root, 'docs/STACK.md');
  const hasArchitecture = exists(root, 'docs/architecture') || exists(root, 'docs/architecture.md');
  const hasAdr = exists(root, 'docs/adr');
  const hasPackageJson = exists(root, 'package.json');
  const hasOwnership = Array.isArray(pi?.ownership) && pi.ownership.length > 0;
  const hasProtected = Array.isArray(pi?.policy?.protected_paths) && pi.policy.protected_paths.length > 0;
  const verificationCommands = Array.isArray(pi?.verification?.commands) ? pi.verification.commands : [];
  const hasVerification = verificationCommands.length > 0;
  const hasDeployment = !!(pi?.deployment && typeof pi.deployment === 'object' && Object.keys(pi.deployment).length);
  const projectType = pi?.project?.type || null;
  const yamlPath = path.join(root, '.agent-os', 'project.yaml');
  const piRaw = fs.existsSync(yamlPath) ? fs.readFileSync(yamlPath, 'utf8') : '';

  return {
    project_dir: root.replace(/\\/g, '/'),
    discovery_mode: discovery.mode,
    initialized,
    project_id: pi?.project?.id || null,
    project_type: projectType,
    contract_version: pi?.contract?.version ?? pi?.schema_version ?? null,
    has_source: hasSource,
    has_tests: hasTests,
    has_docs: hasDocs,
    has_agents_md: hasAgentsMd,
    has_readme: hasReadme,
    has_stack_doc: hasStackDoc,
    has_architecture: hasArchitecture,
    has_adr: hasAdr,
    has_package_json: hasPackageJson,
    has_ownership: hasOwnership,
    has_protected_paths: hasProtected,
    has_verification_commands: hasVerification,
    verification_commands: verificationCommands,
    has_deployment: hasDeployment,
    file_count: files.length,
    dir_count: dirs.length,
    project_intelligence: pi,
    project_intelligence_fingerprint: fingerprintText(piRaw),
    signals: discovery.signals || {},
  };
}
