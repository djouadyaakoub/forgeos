/**
 * Distribution configuration loader — generic, no credentials
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.join(POLICY_ROOT, 'distribution.yaml');

function parseSimpleYaml(content) {
  const distribution = {};
  let section = null;
  let subsection = null;

  for (const line of String(content).split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.trim()) continue;

    const root = line.match(/^(\w+):/);
    if (root && !line.startsWith(' ')) {
      section = root[1];
      if (section !== 'distribution') continue;
      continue;
    }

    const key2 = line.match(/^\s{2}(\w+):\s*(.*)$/);
    if (!key2 || section !== 'distribution') continue;

    const key = key2[1];
    const rawVal = key2[2].trim().replace(/^"|"$/g, '');

    const key4 = line.match(/^\s{4}(\w+):\s*(.*)$/);
    if (key4) {
      subsection = key;
      distribution[subsection] = distribution[subsection] || {};
      distribution[subsection][key4[1]] = key4[2].trim().replace(/^"|"$/g, '');
      continue;
    }

    if (['source', 'update'].includes(key)) {
      subsection = key;
      distribution[subsection] = distribution[subsection] || {};
      continue;
    }

    distribution[key] = rawVal;
  }

  return { distribution };
}

export function loadDistributionConfig(configPath = DEFAULT_CONFIG_PATH) {
  if (!fs.existsSync(configPath)) {
    return getDefaultConfig();
  }
  const parsed = parseSimpleYaml(fs.readFileSync(configPath, 'utf8'));
  const d = parsed.distribution || {};
  return {
    ...getDefaultConfig(),
    ...d,
    source: { ...getDefaultConfig().source, ...d.source },
    update: { ...getDefaultConfig().update, ...d.update },
  };
}

export function getDefaultConfig() {
  return {
    source: {
      provider: 'github',
      owner: '',
      repository: 'forgeos',
      plugin_id: 'forgeos',
    },
    release_channel: 'stable',
    update: {
      enabled: true,
      check_interval: '24h',
    },
    adapters: {
      cursor: {
        plugin_id: 'cursor-agent-os',
      },
    },
  };
}

export function isGithubConfigured(config) {
  return Boolean(config?.source?.repository && config?.source?.plugin_id);
}

export { DEFAULT_CONFIG_PATH };
