/**
 * Dead code analysis — evidence-based candidates, no auto-delete
 */
import fs from 'node:fs';
import path from 'node:path';
import { walkProject } from '../structure/analyzer.mjs';

export function analyzeDeadCode(projectDir, options = {}) {
  const { files } = walkProject(projectDir, options);
  const candidates = [];

  for (const f of files) {
    const base = path.basename(f).toLowerCase();
    const ext = path.extname(f).toLowerCase();
    if (!['.go', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.dart'].includes(ext)) continue;

    if (base.includes('unused') || base.includes('deprecated') || base.includes('.bak')) {
      candidates.push({
        candidate: f,
        evidence: 'filename suggests unused/deprecated',
        confidence: 0.7,
        risk: 'MEDIUM',
        recommended_action: 'review_before_remove',
      });
    }

    if (base.startsWith('_') && !base.includes('test')) {
      candidates.push({
        candidate: f,
        evidence: 'private/unlinked file naming pattern',
        confidence: 0.4,
        risk: 'LOW',
        recommended_action: 'verify_references',
      });
    }
  }

  return {
    capability: 'dead-code-analysis',
    candidates,
    auto_delete: false,
    summary: {
      total_candidates: candidates.length,
      high_confidence: candidates.filter((c) => c.confidence >= 0.7).length,
    },
  };
}
