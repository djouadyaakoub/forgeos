#!/usr/bin/env node
/**
 * Install Universal Cursor Agent OS at user scope.
 *
 * Usage:
 *   node bootstrap/install-plugin.mjs [--plugin-root <path>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeInstallManifest, resolvePluginRoot, getInstallManifestPath } from '../policy/plugin-root.mjs';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const rootIdx = args.indexOf('--plugin-root');
const pluginRoot = rootIdx >= 0 ? path.resolve(args[rootIdx + 1]) : PLUGIN_ROOT;

const manifest = writeInstallManifest(pluginRoot);
const verify = resolvePluginRoot({ skipDevFallback: true });

const report = {
  action: 'install',
  install_manifest: getInstallManifestPath().replace(/\\/g, '/'),
  plugin_root: manifest.plugin_root,
  version: manifest.version,
  verified: verify.root === path.resolve(pluginRoot),
  resolution_source: verify.source,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.verified ? 0 : 1);
