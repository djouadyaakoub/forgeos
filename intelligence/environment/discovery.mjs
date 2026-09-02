/**
 * Environment discovery — detect environments from project evidence
 */
import fs from 'node:fs';
import path from 'node:path';

const ENV_FILES = [
  { pattern: '.env.production', env: 'production' },
  { pattern: '.env.staging', env: 'staging' },
  { pattern: '.env.development', env: 'development' },
  { pattern: '.env.local', env: 'local' },
  { pattern: '.env.test', env: 'test' },
];

export function discoverEnvironments(projectDir, adapter = {}) {
  const environments = new Map();

  if (adapter.environment?.environments?.length) {
    for (const e of adapter.environment.environments) {
      environments.set(e.name || e.id, {
        name: e.name || e.id,
        source: 'adapter',
        config_files: e.config_files || [],
        required_keys: e.required_keys || [],
      });
    }
  }

  if (projectDir && fs.existsSync(projectDir)) {
    for (const { pattern, env } of ENV_FILES) {
      const full = path.join(projectDir, pattern);
      if (fs.existsSync(full)) {
        environments.set(env, {
          name: env,
          source: 'filesystem',
          config_files: [pattern],
          required_keys: extractKeysFromEnvFile(full),
        });
      }
    }

    for (const sub of ['backend', 'web', 'frontend', 'app']) {
      for (const { pattern, env } of ENV_FILES) {
        const full = path.join(projectDir, sub, pattern);
        if (fs.existsSync(full)) {
          const key = `${env}:${sub}`;
          environments.set(key, {
            name: env,
            component: sub,
            source: 'filesystem',
            config_files: [`${sub}/${pattern}`],
            required_keys: extractKeysFromEnvFile(full),
          });
        }
      }
    }
  }

  if (!environments.size) {
    environments.set('development', { name: 'development', source: 'default', config_files: [], required_keys: [] });
  }

  return {
    capability: 'environment-discovery',
    environments: [...environments.values()],
  };
}

function extractKeysFromEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => l.split('=')[0].trim());
  } catch {
    return [];
  }
}
