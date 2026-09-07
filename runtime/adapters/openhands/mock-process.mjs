/**
 * Helpers to spawn an out-of-process mock Agent Server (avoids spawnSync deadlock).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'mock-agent-server-cli.mjs'
);

/**
 * @param {object} [options]
 * @param {string} [options.behavior]
 * @param {string} [options.sessionKey]
 * @param {string} [options.version]
 */
export async function startMockAgentServerProcess(options = {}) {
  const child = spawn(process.execPath, [CLI, '0'], {
    env: {
      ...process.env,
      MOCK_OH_BEHAVIOR: options.behavior || 'success',
      MOCK_OH_SESSION_KEY: options.sessionKey || '',
      MOCK_OH_VERSION: options.version || 'mock-agent-server-0.1.0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const info = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('mock server start timeout'));
    }, 10000);
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const line = buf.split(/\r?\n/).find((l) => l.trim().startsWith('{'));
      if (line) {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(line));
        } catch (err) {
          reject(err);
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      // surface for debugging
      if (process.env.DEBUG_MOCK_OH) {
        process.stderr.write(chunk);
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`mock server exited early: ${code}`));
    });
  });

  return {
    baseUrl: info.baseUrl,
    port: info.port,
    pid: info.pid,
    async close() {
      if (child.killed) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 3000);
        child.on('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
}
