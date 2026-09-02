/**
 * Universal Cursor Agent OS — project discovery
 */
import fs from 'node:fs';
import path from 'node:path';
import { discoverProject, isProjectInitialized, loadProjectManifest } from '../policy/project-adapter.mjs';
import { extractProjectAdapter, summarizeAdapter } from './adapter-extraction.mjs';

const SKIP_DIRS = new Set([
  '.git',
  '.cursor',
  'node_modules',
  'vendor',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '__pycache__',
]);

const STACK_MARKERS = {
  go: {
    files: ['go.mod', 'go.sum'],
    extensions: ['.go'],
  },
  node: {
    files: ['package.json'],
    lockfiles: ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'],
  },
  python: {
    files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'],
  },
  rust: {
    files: ['Cargo.toml', 'Cargo.lock'],
  },
  flutter: {
    files: ['pubspec.yaml'],
    extensions: ['.dart'],
  },
  dotnet: {
    extensions: ['.csproj', '.sln', '.fsproj'],
  },
  java: {
    files: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'],
  },
  docker: {
    files: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'],
  },
};

const DEFAULT_COMPONENT_DIRS = [
  'backend',
  'frontend',
  'web',
  'app',
  'mobile',
  'superadmin',
  'api',
  'server',
  'client',
  'packages',
  'services',
];

function normalizeProjectDir(projectDir) {
  return path.resolve(projectDir);
}

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith('.');
}

function walkRepository(projectDir, visitor, options = {}) {
  const maxDepth = options.maxDepth ?? 8;
  const root = normalizeProjectDir(projectDir);

  function walk(dir, depth) {
    if (depth > maxDepth || !fs.existsSync(dir)) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (shouldSkipDir(ent.name)) continue;
        walk(path.join(dir, ent.name), depth + 1);
        continue;
      }
      if (!ent.isFile()) continue;
      visitor(ent.name, path.join(dir, ent.name), path.relative(root, path.join(dir, ent.name)).replace(/\\/g, '/'));
    }
  }

  walk(root, 0);
}

function collectMarkerHits(projectDir) {
  const hits = Object.fromEntries(Object.keys(STACK_MARKERS).map((k) => [k, []]));

  walkRepository(projectDir, (fileName, absPath, relPath) => {
    for (const [tech, markers] of Object.entries(STACK_MARKERS)) {
      if (markers.files?.includes(fileName)) {
        hits[tech].push(relPath);
        continue;
      }
      if (markers.lockfiles?.includes(fileName)) {
        hits[tech].push(relPath);
        continue;
      }
      if (markers.extensions?.some((ext) => fileName.endsWith(ext))) {
        hits[tech].push(relPath);
      }
    }
  });

  for (const tech of Object.keys(hits)) {
    hits[tech] = [...new Set(hits[tech])].sort();
  }
  return hits;
}

function hitsToFlags(hits) {
  const flags = {};
  for (const [tech, paths] of Object.entries(hits)) {
    flags[tech] = paths.length > 0;
  }
  return flags;
}

function topLevelComponentName(relPath) {
  const parts = relPath.split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : '.';
}

export function detectStackIndicators(projectDir) {
  const hits = collectMarkerHits(projectDir);
  return hitsToFlags(hits);
}

function summarizeEvidence(hits) {
  const summary = {};
  for (const [tech, paths] of Object.entries(hits)) {
    const markers = STACK_MARKERS[tech];
    const primary = new Set([...(markers.files || []), ...(markers.lockfiles || []), ...(markers.extensions || [])]);
    summary[tech] = paths.filter((relPath) => {
      const base = relPath.split('/').pop();
      if (markers.files?.includes(base) || markers.lockfiles?.includes(base)) return true;
      if (markers.extensions?.some((ext) => base.endsWith(ext))) {
        // keep one representative extension sample per directory
        return markers.files?.length === 0 && !paths.some((p) => markers.files?.includes(p.split('/').pop()));
      }
      return false;
    });
    // Prefer marker files; fall back to first path if only extensions matched
    if (summary[tech].length === 0 && paths.length > 0) {
      const markerOnly = paths.filter((relPath) => {
        const base = relPath.split('/').pop();
        return markers.files?.includes(base) || markers.lockfiles?.includes(base);
      });
      summary[tech] = markerOnly.length > 0 ? markerOnly : [paths[0]];
    }
  }
  return summary;
}

export function detectStackDetail(projectDir) {
  const hits = collectMarkerHits(projectDir);
  const repository = hitsToFlags(hits);
  const components = {};

  for (const [tech, paths] of Object.entries(hits)) {
    for (const relPath of paths) {
      const component = topLevelComponentName(relPath);
      if (!components[component]) {
        components[component] = Object.fromEntries(Object.keys(STACK_MARKERS).map((k) => [k, false]));
      }
      components[component][tech] = true;
      repository[tech] = true;
    }
  }

  return { repository, components, evidence: hits, evidence_summary: summarizeEvidence(hits) };
}

export function detectDocPaths(projectDir) {
  const candidates = [
    'AGENTS.md',
    'docs/STACK.md',
    'docs/architecture',
    'docs/contracts',
    'docs/adr',
    'docs/runbooks',
    'docs/project/state.yaml',
    'README.md',
  ];
  return candidates.filter((p) => fs.existsSync(path.join(projectDir, p)));
}

export function resolveProjectKind(projectDir) {
  const root = normalizeProjectDir(projectDir);
  const manifest = loadProjectManifest(root);
  if (manifest.data) {
    return {
      project_kind: 'AGENT_OS_INITIALIZED',
      agent_os_initialized: true,
      existing_project: true,
    };
  }

  const signals = {
    agents_md: fs.existsSync(path.join(root, 'AGENTS.md')),
    readme: fs.existsSync(path.join(root, 'README.md')),
    stack_doc: fs.existsSync(path.join(root, 'docs/STACK.md')),
    project_registry: fs.existsSync(path.join(root, '.cursor/agents/registry.yaml')),
    task_store: fs.existsSync(path.join(root, 'docs/project/tasks')),
    cursor_rules: fs.existsSync(path.join(root, '.cursor/rules')),
  };

  const existingProject =
    signals.agents_md ||
    signals.stack_doc ||
    signals.project_registry ||
    signals.task_store ||
    (signals.readme && hasSubstantialCodeTree(root));

  if (existingProject) {
    return {
      project_kind: 'EXISTING_PROJECT',
      agent_os_initialized: false,
      existing_project: true,
      signals,
    };
  }

  return {
    project_kind: 'UNINITIALIZED',
    agent_os_initialized: false,
    existing_project: false,
    signals,
  };
}

function hasSubstantialCodeTree(projectDir) {
  let markerCount = 0;
  walkRepository(
    projectDir,
    () => {
      markerCount += 1;
    },
    { maxDepth: 3 }
  );
  return markerCount > 0;
}

export function buildProjectProfile(projectDir) {
  const root = normalizeProjectDir(projectDir);
  const discovery = discoverProject(root);
  const kind = resolveProjectKind(root);
  const stackDetail = detectStackDetail(root);
  const docs = detectDocPaths(root);
  const topLevel = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);

  const diagnostics = collectDiagnostics(root, stackDetail, docs, kind);
  const extraction = kind.existing_project || kind.project_kind === 'AGENT_OS_INITIALIZED'
    ? extractProjectAdapter(root)
    : { adapter: null, validation: { valid: true, issues: [] } };

  return {
    ...discovery,
    ...kind,
    mode: kind.project_kind,
    project_dir: root,
    stack: stackDetail,
    stack_indicators: stackDetail.repository,
    existing_docs: docs,
    top_level_dirs: topLevel,
    initialized: isProjectInitialized(root),
    diagnostics,
    adapter: extraction.adapter,
    adapter_validation: extraction.validation,
    adapter_summary: extraction.adapter ? summarizeAdapter(extraction.adapter) : null,
  };
}

function collectDiagnostics(projectDir, stackDetail, docs, kind) {
  const diagnostics = [];
  const repo = stackDetail.repository;
  const anyDetected = Object.values(repo).some(Boolean);

  if (kind.project_kind === 'EXISTING_PROJECT' && docs.includes('docs/STACK.md') && !anyDetected) {
    diagnostics.push({
      type: 'stack_detection_warning',
      message: 'docs/STACK.md exists but no supported stack markers were detected in the repository tree',
    });
  }

  if (kind.existing_project && !anyDetected && hasSubstantialCodeTree(projectDir)) {
    diagnostics.push({
      type: 'stack_detection_warning',
      message: 'Existing project contains files but no supported stack markers were detected',
    });
  }

  if (kind.project_kind === 'UNINITIALIZED' && anyDetected) {
    diagnostics.push({
      type: 'stack_detection_note',
      message: 'Stack markers detected in an otherwise uninitialized project tree',
    });
  }

  return diagnostics;
}

export function findContradictions(profile) {
  const contradictions = [...(profile.diagnostics || []), ...(profile.adapter?.contradictions || [])];
  const hasGo = profile.stack_indicators?.go;
  const stackDoc = profile.existing_docs?.includes('docs/STACK.md');
  if (hasGo && stackDoc) {
    contradictions.push({ type: 'review_recommended', message: 'Verify docs/STACK.md matches detected Go markers' });
  }
  return contradictions;
}

export function compareStackDetection(projectDirA, projectDirB) {
  const a = detectStackDetail(normalizeProjectDir(projectDirA));
  const b = detectStackDetail(normalizeProjectDir(projectDirB));
  const same = JSON.stringify(a.repository) === JSON.stringify(b.repository)
    && JSON.stringify(a.components) === JSON.stringify(b.components);
  return { same, a, b };
}
