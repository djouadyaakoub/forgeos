/**
 * Multi-format agent/capability extraction from diverse project layouts
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeCapability, normalizeAgent, normalizeOwnership, normalizeVerification } from './capability-normalizer.mjs';

function readIfExists(root, rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function extractFromSpecialistsMd(projectDir) {
  const raw = readIfExists(projectDir, 'docs/agents/SPECIALISTS.md');
  if (!raw) return { capabilities: [], agents: [], source: null };

  const capabilities = [];
  const agents = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const row = line.match(/^\|\s*([^|]+)\|\s*([^|]+)\|\s*\[task-playbooks\/([^\]]+)\]/);
    if (!row) continue;

    const signals = row[1].trim();
    const specialistName = row[2].trim();
    const playbookFile = row[3].trim();
    const agentId = slugify(specialistName);
    const capId = slugify(specialistName.replace(/\//g, '-'));

    agents.push(
      normalizeAgent({
        id: agentId,
        source: 'docs/agents/SPECIALISTS.md',
        source_type: 'agents_md',
        playbook: `docs/agents/task-playbooks/${playbookFile}`,
        capabilities: [capId],
        evidence: [signals.slice(0, 80)],
        exists: fs.existsSync(path.join(projectDir, 'docs/agents/task-playbooks', playbookFile)),
      })
    );

    capabilities.push(
      normalizeCapability({
        id: capId,
        description: specialistName,
        agent: agentId,
        domains: inferDomainsFromSignals(signals),
        source: 'docs/agents/SPECIALISTS.md',
        source_type: 'agents_md',
        playbook: `docs/agents/task-playbooks/${playbookFile}`,
        evidence: [signals.slice(0, 80)],
        inferred: true,
        confidence: 0.75,
      })
    );
  }

  return { capabilities, agents, source: 'docs/agents/SPECIALISTS.md' };
}

function inferDomainsFromSignals(signals) {
  const s = signals.toLowerCase();
  const domains = [];
  if (/backend|api|rpc|supabase/i.test(s)) domains.push('backend');
  if (/frontend|react|admin-web/i.test(s)) domains.push('frontend');
  if (/mobile|flutter|pdv|hce/i.test(s)) domains.push('mobile');
  if (/database|rls|migration|sql/i.test(s)) domains.push('database');
  if (/deploy|ci|ota|worker/i.test(s)) domains.push('devops');
  if (/security|auth|kyc|pii/i.test(s)) domains.push('security');
  if (/bug|qa|test/i.test(s)) domains.push('qa');
  if (/docs/i.test(s)) domains.push('documentation');
  return domains;
}

export function extractFromPlaybooks(projectDir) {
  const dir = path.join(projectDir, 'docs/agents/task-playbooks');
  if (!fs.existsSync(dir)) return { capabilities: [], agents: [], source: null };

  const capabilities = [];
  const agents = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');

  for (const file of files) {
    const rel = `docs/agents/task-playbooks/${file}`;
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    const titleMatch = content.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : file.replace(/\.md$/, '');
    const agentId = slugify(title);
    const capId = slugify(file.replace(/^\d+-/, '').replace(/\.md$/, ''));

    agents.push(
      normalizeAgent({
        id: agentId,
        source: rel,
        source_type: 'playbook',
        playbook: rel,
        capabilities: [capId],
        file: rel,
        exists: true,
        evidence: [title],
      })
    );

    capabilities.push(
      normalizeCapability({
        id: capId,
        description: title,
        agent: agentId,
        source: rel,
        source_type: 'playbook',
        playbook: rel,
        evidence: [title],
        inferred: true,
        confidence: 0.8,
      })
    );
  }

  return { capabilities, agents, source: 'docs/agents/task-playbooks/' };
}

export function extractFromAgentsMd(projectDir) {
  const raw = readIfExists(projectDir, 'AGENTS.md');
  if (!raw) return { capabilities: [], agents: [], source: null };

  const capabilities = [];
  const agents = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const playbookRow = line.match(/^\|\s*([^|]+)\|\s*`([^`]+)`\s*$/);
    if (playbookRow) {
      const domain = playbookRow[1].trim();
      const playbook = playbookRow[2].trim();
      const capId = slugify(domain);
      const agentId = slugify(playbook.replace(/\.md$/, '').replace(/^\d+-/, ''));

      agents.push(
        normalizeAgent({
          id: agentId,
          source: 'AGENTS.md',
          source_type: 'agents_md',
          playbook,
          capabilities: [capId],
          evidence: [domain],
        })
      );
      capabilities.push(
        normalizeCapability({
          id: capId,
          description: domain,
          agent: agentId,
          source: 'AGENTS.md',
          source_type: 'agents_md',
          playbook,
          evidence: [domain],
          inferred: true,
          confidence: 0.7,
        })
      );
    }
  }

  return { capabilities, agents, source: 'AGENTS.md' };
}

export function extractFromOwnershipDoc(projectDir) {
  const candidates = [
    'docs/map/ownership.md',
    'docs/ownership.md',
    'docs/map/repository-map.md',
  ];
  const ownership = [];

  for (const rel of candidates) {
    const raw = readIfExists(projectDir, rel);
    if (!raw) continue;

    for (const line of raw.split(/\r?\n/)) {
      const row = line.match(/^\|\s*([^|]+)\|\s*`([^`]+)`\s*/);
      if (!row) continue;
      const area = row[1].trim();
      const pathsRaw = row[2].trim();
      const paths = pathsRaw.split(/[,]/).map((p) => p.trim().replace(/`/g, '')).filter(Boolean);
      const agentId = slugify(area);

      for (const p of paths) {
        ownership.push(
          normalizeOwnership({
            path: p.endsWith('/') ? p : `${p}/`,
            paths: [p.endsWith('/') ? p : `${p}/`],
            agent: agentId,
            source: rel,
            source_type: 'ownership_doc',
            evidence: [area, pathsRaw],
            inferred: true,
            confidence: 0.75,
          })
        );
      }
    }
  }

  return { ownership, source: ownership.length ? candidates.find((c) => readIfExists(projectDir, c)) : null };
}

export function extractVerificationFromDocs(projectDir) {
  const commands = [];
  const seen = new Set();

  function add(name, command, source, component) {
    const key = `${command}`;
    if (!command || seen.has(key)) return;
    seen.add(key);
    commands.push(
      normalizeVerification({
        name,
        command,
        source,
        source_type: source.includes('AGENTS') ? 'agents_md' : 'package_manifest',
        component,
        evidence: [command],
      })
    );
  }

  const agentsMd = readIfExists(projectDir, 'AGENTS.md');
  if (agentsMd) {
    const codeBlocks = agentsMd.match(/```[\w]*\n([\s\S]*?)```/g) || [];
    for (const block of codeBlocks) {
      const inner = block.replace(/```[\w]*\n?|```/g, '').trim();
      for (const line of inner.split('\n')) {
        const l = line.trim();
        if (l.startsWith('cd ') || l.startsWith('npm ') || l.startsWith('flutter ') || l.startsWith('.\\')) {
          add('agents-md-cmd', l, 'AGENTS.md', 'project');
        }
      }
    }
  }

  const topDirs = ['admin-web', 'pdv', 'distributeur', 'backend', 'web'];
  for (const dir of topDirs) {
    const pkgPath = path.join(projectDir, dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
          if (['build', 'test', 'lint', 'check', 'dev'].some((k) => name.includes(k))) {
            add(`${dir}:${name}`, `cd ${dir} && npm run ${name}`, `${dir}/package.json`, dir);
          }
        }
      } catch {
        /* skip */
      }
    }
    if (fs.existsSync(path.join(projectDir, dir, 'pubspec.yaml'))) {
      add(`${dir}:flutter-test`, `cd ${dir} && flutter test`, `${dir}/pubspec.yaml`, dir);
      add(`${dir}:flutter-analyze`, `cd ${dir} && flutter analyze`, `${dir}/pubspec.yaml`, dir);
    }
  }

  return commands;
}

export function extractAllFormats(projectDir) {
  const specialists = extractFromSpecialistsMd(projectDir);
  const playbooks = extractFromPlaybooks(projectDir);
  const agentsMd = extractFromAgentsMd(projectDir);
  const ownershipDoc = extractFromOwnershipDoc(projectDir);
  const verification = extractVerificationFromDocs(projectDir);

  return {
    capability_sources: [specialists, playbooks, agentsMd],
    agent_sources: [specialists, playbooks, agentsMd],
    ownership_sources: ownershipDoc.ownership || [],
    verification,
    sources: {
      specialists: specialists.source,
      playbooks: playbooks.source,
      agents_md: agentsMd.source,
      ownership: ownershipDoc.source,
    },
  };
}
