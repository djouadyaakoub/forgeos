/**
 * CI workflow deployment discovery — parse GitHub Actions without secret values
 */
import fs from 'node:fs';
import path from 'node:path';

const DEPLOY_PATTERNS = [
  { pattern: /npx\s+wrangler\s+pages\s+deploy/i, provider: 'cloudflare-pages', confidence: 0.95 },
  { pattern: /wrangler\s+pages\s+deploy/i, provider: 'cloudflare-pages', confidence: 0.9 },
  { pattern: /wrangler\s+deploy/i, provider: 'cloudflare-worker', confidence: 0.85 },
  { pattern: /supabase\s+db\s+push/i, provider: 'supabase', confidence: 0.9 },
  { pattern: /supabase\s+migration/i, provider: 'supabase', confidence: 0.85 },
  { pattern: /fly\s+deploy/i, provider: 'fly.io', confidence: 0.95 },
  { pattern: /vercel\s+deploy/i, provider: 'vercel', confidence: 0.9 },
  { pattern: /railway\s+up/i, provider: 'railway', confidence: 0.9 },
  { pattern: /docker\s+build/i, provider: 'docker', confidence: 0.7 },
  { pattern: /docker\s+push/i, provider: 'docker', confidence: 0.75 },
  { pattern: /flutter\s+build/i, provider: 'flutter-build', confidence: 0.65 },
];

const SECRET_REF = /\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g;

export function parseWorkflowYaml(content, filePath = '') {
  const lines = String(content).split(/\r?\n/);
  const workflow = {
    name: null,
    jobs: [],
    file: filePath,
    steps: [],
    secret_refs: [],
    deploy_commands: [],
  };

  let currentJob = null;
  let inSteps = false;
  let stepIndent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch && !workflow.name) {
      workflow.name = nameMatch[1].replace(/^["']|["']$/g, '');
      continue;
    }

    const jobMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (jobMatch && !line.includes('steps:')) {
      currentJob = { id: jobMatch[1], steps: [] };
      workflow.jobs.push(currentJob);
      inSteps = false;
      continue;
    }

    if (/^\s+steps:\s*$/.test(line)) {
      inSteps = true;
      stepIndent = line.match(/^(\s*)/)[1].length;
      continue;
    }

    if (inSteps && currentJob) {
      const indent = line.match(/^(\s*)/)[1].length;
      if (indent <= stepIndent && !trimmed.startsWith('-')) {
        inSteps = false;
        continue;
      }
      const runMatch = trimmed.match(/^run:\s*(.+)$/i) || trimmed.match(/^- run:\s*(.+)$/i);
      if (runMatch) {
        const cmd = runMatch[1].replace(/^["']|["']$/g, '');
        currentJob.steps.push({ type: 'run', command: cmd });
        workflow.steps.push({ job: currentJob.id, command: cmd });
        scanDeployCommand(cmd, filePath, workflow);
      }
      const usesMatch = trimmed.match(/uses:\s*(.+)$/i);
      if (usesMatch) {
        currentJob.steps.push({ type: 'uses', action: usesMatch[1] });
      }
    }

    for (const m of content.matchAll(SECRET_REF)) {
      if (!workflow.secret_refs.includes(m[1])) workflow.secret_refs.push(m[1]);
    }
  }

  return workflow;
}

function scanDeployCommand(cmd, filePath, workflow) {
  for (const { pattern, provider, confidence } of DEPLOY_PATTERNS) {
    if (pattern.test(cmd)) {
      workflow.deploy_commands.push({
        command: cmd,
        provider,
        confidence,
        evidence: [filePath, cmd.slice(0, 120)],
      });
    }
  }
}

export function discoverCiDeployments(projectDir) {
  const workflowsDir = path.join(projectDir, '.github/workflows');
  if (!fs.existsSync(workflowsDir)) {
    return { workflows: [], targets: [], secret_refs: [] };
  }

  const workflows = [];
  const targets = [];
  const seen = new Set();
  const allSecretRefs = [];

  const files = fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  for (const file of files) {
    const rel = `.github/workflows/${file}`;
    const full = path.join(workflowsDir, file);
    const content = fs.readFileSync(full, 'utf8');
    const parsed = parseWorkflowYaml(content, rel);
    workflows.push(parsed);
    allSecretRefs.push(...parsed.secret_refs);

    for (const dc of parsed.deploy_commands) {
      const component = inferComponentFromWorkflow(rel, parsed, dc.command);
      const key = `${component}:${dc.provider}:${rel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        deployment_target: {
          component,
          provider: dc.provider,
          confidence: dc.confidence,
          evidence: [rel, dc.command.slice(0, 100)],
          config: rel,
          environment: inferEnvironment(parsed, content),
          deployable: true,
          source: 'ci_workflow',
          workflow_name: parsed.name,
        },
      });
    }
  }

  return {
    workflows,
    targets,
    secret_refs: [...new Set(allSecretRefs)],
    count: targets.length,
  };
}

function inferComponentFromWorkflow(workflowPath, workflow, command) {
  const p = workflowPath.toLowerCase();
  const c = command.toLowerCase();
  if (p.includes('admin-web') || c.includes('admin-web')) return 'admin-web';
  if (p.includes('supabase') || c.includes('supabase')) return 'database';
  if (p.includes('mobile') || c.includes('flutter')) return 'mobile';
  if (p.includes('worker') || c.includes('wrangler deploy')) return 'worker';
  if (p.includes('pages')) return 'web';
  const wd = workflow.name?.toLowerCase() || '';
  if (wd.includes('admin')) return 'admin-web';
  if (wd.includes('supabase')) return 'database';
  return 'ci';
}

function inferEnvironment(workflow, content) {
  if (/production/i.test(content) || /admin\.sim-dz/i.test(content)) return 'production';
  if (/staging/i.test(content)) return 'staging';
  return '';
}

export function mergeCiTargets(existingTargets, ciDiscovery) {
  const merged = [...existingTargets];
  const seen = new Set(
    existingTargets.map((t) => `${t.deployment_target?.component}:${t.deployment_target?.provider}`)
  );

  for (const t of ciDiscovery.targets || []) {
    const dt = t.deployment_target;
    const key = `${dt.component}:${dt.provider}`;
    const existing = merged.find(
      (m) => m.deployment_target?.component === dt.component && m.deployment_target?.provider === dt.provider
    );
    if (existing) {
      if (dt.confidence > (existing.deployment_target.confidence || 0)) {
        existing.deployment_target.confidence = dt.confidence;
        existing.deployment_target.evidence = [
          ...new Set([...(existing.deployment_target.evidence || []), ...(dt.evidence || [])]),
        ];
        existing.deployment_target.source = 'ci_workflow+filesystem';
      }
      continue;
    }
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(t);
    }
  }

  return merged;
}
