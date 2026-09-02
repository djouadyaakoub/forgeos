/**
 * Deployment discovery — evidence-based target detection (no hard-coded platforms)
 */
import fs from 'node:fs';
import path from 'node:path';
import { discoverCiDeployments, mergeCiTargets } from './ci-discovery.mjs';

const EVIDENCE_MAP = [
  { file: 'fly.toml', provider: 'fly.io', component: 'backend', confidence: 0.9 },
  { file: 'wrangler.toml', provider: 'cloudflare-pages', component: 'web', confidence: 0.85 },
  { file: 'vercel.json', provider: 'vercel', component: 'frontend', confidence: 0.9 },
  { file: 'railway.json', provider: 'railway', component: 'backend', confidence: 0.9 },
  { file: 'railway.toml', provider: 'railway', component: 'backend', confidence: 0.9 },
  { file: 'Dockerfile', provider: 'docker', component: 'container', confidence: 0.7 },
  { file: 'pubspec.yaml', provider: 'flutter-build', component: 'mobile', confidence: 0.6 },
  { dir: 'supabase/migrations', provider: 'supabase', component: 'database', confidence: 0.85 },
  { dir: '.github/workflows', provider: 'ci-cd', component: 'ci', confidence: 0.5 },
];

function fileExists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function findInTree(root, filename, maxDepth = 4) {
  const found = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name === filename) {
        found.push(path.relative(root, full).replace(/\\/g, '/'));
      }
      if (e.isDirectory()) walk(full, depth + 1);
    }
  }
  walk(root, 0);
  return found;
}

export function discoverDeploymentTargets(projectContext = {}) {
  const projectDir = projectContext.project_dir || projectContext.projectDir;
  const adapter = projectContext.project_adapter || projectContext.adapter || {};
  const targets = [];
  const seen = new Set();

  if (adapter.deployment?.platforms) {
    for (const [component, cfg] of Object.entries(adapter.deployment.platforms)) {
      const key = `${component}:${cfg.provider}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        deployment_target: {
          component,
          provider: cfg.provider || 'unknown',
          confidence: 1.0,
          evidence: ['project_adapter'],
          config: cfg.config || '',
          environment: cfg.environment || '',
          deployable: cfg.deployable !== false,
          source: 'adapter',
        },
      });
    }
  }

  if (adapter.deployment?.profiles) {
    for (const profile of adapter.deployment.profiles) {
      const key = `${profile.component}:${profile.provider}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        deployment_target: {
          component: profile.component,
          provider: profile.provider,
          confidence: 1.0,
          evidence: ['deployment_profile'],
          config: profile.config || '',
          environment: profile.environment || '',
          deployable: true,
          source: 'adapter_profile',
        },
      });
    }
  }

  if (projectDir && fs.existsSync(projectDir)) {
    for (const ev of EVIDENCE_MAP) {
      let paths = [];
      if (ev.file) paths = findInTree(projectDir, ev.file);
      if (ev.dir && fileExists(projectDir, ev.dir)) paths = [ev.dir];

      for (const configPath of paths) {
        const component = inferComponent(configPath, ev.component);
        const key = `${component}:${ev.provider}:${configPath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({
          deployment_target: {
            component,
            provider: ev.provider,
            confidence: ev.confidence,
            evidence: [configPath],
            config: configPath,
            environment: '',
            deployable: true,
            source: 'filesystem',
          },
        });
      }
    }

    const pkgPath = path.join(projectDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const scripts = pkg.scripts || {};
        for (const [name, cmd] of Object.entries(scripts)) {
          if (/deploy|release|publish/i.test(name) || /fly deploy|wrangler|vercel|railway/i.test(String(cmd))) {
            targets.push({
              deployment_target: {
                component: 'node',
                provider: inferProviderFromCommand(cmd),
                confidence: 0.75,
                evidence: [`package.json scripts.${name}`],
                config: 'package.json',
                environment: '',
                deployable: true,
                source: 'package_script',
              },
            });
          }
        }
      } catch {
        /* skip */
      }
    }

    const ciDiscovery = discoverCiDeployments(projectDir);
    const merged = mergeCiTargets(targets, ciDiscovery);
    return {
      capability: 'deployment-discovery',
      targets: merged,
      count: merged.length,
      project_id: adapter.project?.id || null,
      ci_workflows: ciDiscovery.workflows?.length || 0,
      ci_secret_refs: ciDiscovery.secret_refs || [],
    };
  }

  return {
    capability: 'deployment-discovery',
    targets,
    count: targets.length,
    project_id: adapter.project?.id || null,
  };
}

function inferComponent(configPath, defaultComponent) {
  const p = configPath.toLowerCase();
  if (p.includes('backend') || p.includes('api') || p.includes('server')) return 'backend';
  if (p.includes('web') || p.includes('app') || p.includes('frontend')) return 'web';
  if (p.includes('mobile') || p.includes('flutter')) return 'mobile';
  if (p.includes('supabase') || p.includes('migration')) return 'database';
  if (p.includes('superadmin') || p.includes('admin')) return 'superadmin';
  return defaultComponent;
}

function inferProviderFromCommand(cmd) {
  const c = String(cmd).toLowerCase();
  if (c.includes('fly')) return 'fly.io';
  if (c.includes('wrangler')) return 'cloudflare-pages';
  if (c.includes('vercel')) return 'vercel';
  if (c.includes('railway')) return 'railway';
  return 'script-deploy';
}

export function getTargetsByComponent(discovery) {
  const map = new Map();
  for (const t of discovery.targets || []) {
    const dt = t.deployment_target;
    if (!map.has(dt.component)) map.set(dt.component, []);
    map.get(dt.component).push(dt);
  }
  return map;
}
