/**
 * Documentation drift detection
 */
import fs from 'node:fs';
import { readProjectText } from '../../host/project-files.mjs';
import path from 'node:path';
import { walkProject } from '../structure/analyzer.mjs';

export function detectDocumentationDrift(projectDir, knowledge = {}) {
  const drift = [];
  const checks = [
    { doc: knowledge.stack || 'docs/STACK.md', label: 'STACK' },
    { doc: knowledge.agents || 'AGENTS.md', label: 'AGENTS' },
    { doc: 'README.md', label: 'README' },
  ];

  const { files } = walkProject(projectDir, { maxFiles: 3000 });
  const hasGo = files.some((f) => f.endsWith('go.mod') || f.endsWith('.go'));
  const hasNode = files.some((f) => f === 'package.json' || f.endsWith('/package.json'));
  const hasFlutter = files.some((f) => f.endsWith('pubspec.yaml'));

  for (const c of checks) {
    let raw;
    try { raw = readProjectText(projectDir, c.doc); }
    catch { drift.push({type:'invalid_doc',path:c.doc,issue:'Document is not a safe bounded regular file',severity:'medium'}); continue; }
    if (raw === null) {
      drift.push({ type: 'missing_doc', path: c.doc, severity: 'medium' });
      continue;
    }
    const content = raw.toLowerCase();
    if (!content.trim()) drift.push({type:'empty_doc',path:c.doc,issue:'Document is empty',severity:'medium'});
    if (c.label === 'STACK') {
      if (hasGo && !content.includes('go')) drift.push({ type: 'stack_drift', path: c.doc, issue: 'Go detected in repo but not mentioned in STACK', severity: 'medium' });
      if (hasFlutter && !content.includes('flutter')) drift.push({ type: 'stack_drift', path: c.doc, issue: 'Flutter detected but not in STACK', severity: 'medium' });
      if (hasNode && !content.includes('node') && !content.includes('react')) drift.push({ type: 'stack_drift', path: c.doc, issue: 'Node detected but not in STACK', severity: 'low' });
    }
  }

  return {
    capability: 'documentation-drift',
    drift_items: drift,
    auto_fix: false,
    use_docs_sync_flow: drift.some((d) => d.severity === 'high'),
    summary: { total: drift.length, high: drift.filter((d) => d.severity === 'high').length },
  };
}
