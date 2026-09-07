/**
 * ForgeOS-native deterministic structural analyzer — Stage 13
 *
 * Pure Node.js. Zero npm dependencies.
 * Extracts file inventory, language, imports/exports, declarations via
 * deterministic pattern analysis for JS/TS family sources.
 *
 * ANALYSIS ONLY — no mutation, no execution, no policy.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { walkProject } from '../../structure/analyzer.mjs';
import {
  validateIntelligenceAdapter,
  createProjectContext,
  unavailableAnalyzeResult,
} from '../adapter.mjs';
import { createStructuralFacts } from '../structural-facts.mjs';

export const FORGEOS_STRUCTURAL_ID = 'forgeos-structural';
export const FORGEOS_STRUCTURAL_VERSION = '0.1.0-stage13';

export const SOURCE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
]);

const LANG_BY_EXT = Object.freeze({
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
});

export const SKIP_PARSE_BASENAMES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
]);

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function detectLanguage(filePath) {
  return LANG_BY_EXT[path.extname(filePath).toLowerCase()] || null;
}

/**
 * Deterministic extraction for JS/TS family files.
 */
export function analyzeSourceText(filePath, content) {
  const language = detectLanguage(filePath);
  if (!language) {
    return {
      language: null,
      imports: [],
      exports: [],
      declarations: [],
      symbols: [],
      diagnostics: [],
    };
  }

  const text = stripComments(content);
  const imports = [];
  const exports = [];
  const declarations = [];
  const symbols = [];
  const diagnostics = [];

  const importRe = /^\s*import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/gm;
  let m;
  while ((m = importRe.exec(text)) !== null) {
    const specRaw = (m[1] || '').replace(/\s+/g, ' ').trim();
    const specs = [];
    if (specRaw.startsWith('{')) {
      specs.push(...specRaw.replace(/[{}]/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean));
    } else if (specRaw) {
      specs.push(specRaw.split(',')[0].trim().replace(/\s+as\s+\w+$/, '').replace(/^\*\s+as\s+/, ''));
    }
    imports.push({
      file: filePath,
      source: m[2],
      specifiers: specs.sort(),
      kind: 'import',
      line: text.slice(0, m.index).split('\n').length,
    });
  }

  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRe.exec(text)) !== null) {
    imports.push({
      file: filePath,
      source: m[1],
      specifiers: [],
      kind: 'require',
      line: text.slice(0, m.index).split('\n').length,
    });
  }

  const exportNamedRe = /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = exportNamedRe.exec(text)) !== null) {
    exports.push({
      file: filePath,
      name: m[1],
      kind: 'named_export',
      line: text.slice(0, m.index).split('\n').length,
    });
  }

  const exportDefaultRe = /^\s*export\s+default\b/gm;
  while ((m = exportDefaultRe.exec(text)) !== null) {
    exports.push({
      file: filePath,
      name: 'default',
      kind: 'default_export',
      line: text.slice(0, m.index).split('\n').length,
    });
  }

  const fnRe = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = fnRe.exec(text)) !== null) {
    declarations.push({
      file: filePath,
      name: m[1],
      kind: 'function',
      line: text.slice(0, m.index).split('\n').length,
    });
    symbols.push({
      file: filePath,
      name: m[1],
      kind: 'function',
      language,
    });
  }

  const classRe = /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = classRe.exec(text)) !== null) {
    declarations.push({
      file: filePath,
      name: m[1],
      kind: 'class',
      line: text.slice(0, m.index).split('\n').length,
    });
    symbols.push({
      file: filePath,
      name: m[1],
      kind: 'class',
      language,
    });
  }

  const constRe = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm;
  while ((m = constRe.exec(text)) !== null) {
    declarations.push({
      file: filePath,
      name: m[1],
      kind: 'variable',
      line: text.slice(0, m.index).split('\n').length,
    });
    symbols.push({
      file: filePath,
      name: m[1],
      kind: 'variable',
      language,
    });
  }

  // Unbalanced braces → malformed diagnostic (deterministic)
  const opens = (text.match(/\{/g) || []).length;
  const closes = (text.match(/\}/g) || []).length;
  if (opens !== closes) {
    diagnostics.push({
      file: filePath,
      code: 'unbalanced_braces',
      message: 'Possible malformed source (brace count mismatch)',
      severity: 'low',
    });
  }

  return { language, imports, exports, declarations, symbols, diagnostics };
}

export function resolveImportPath(fromFile, source, fileSet) {
  if (!source || source.startsWith('.') === false && !source.startsWith('/')) {
    return null; // external package
  }
  const fromDir = path.posix.dirname(fromFile.replace(/\\/g, '/'));
  const raw = path.posix.normalize(path.posix.join(fromDir, source)).replace(/^\.\//, '');
  const candidates = [
    raw,
    `${raw}.js`, `${raw}.mjs`, `${raw}.cjs`, `${raw}.ts`, `${raw}.tsx`, `${raw}.jsx`,
    `${raw}/index.js`, `${raw}/index.mjs`, `${raw}/index.ts`,
  ];
  for (const c of candidates) {
    if (fileSet.has(c)) return c;
  }
  return raw;
}

export function buildFindings({ files, imports, exports, dependency_edges, declarations }) {
  const findings = [];
  const byDir = new Map();

  for (const f of files) {
    const p = f.path;
    if (path.posix.dirname(p) === '.' && SOURCE_EXT.has(path.extname(p))) {
      findings.push({
        type: 'misplaced_source_root',
        path: p,
        message: 'Source file at repository root',
        severity: 'medium',
        confidence: 'HIGH',
        evidence: ['path_layout'],
        scope: p,
        fingerprint: sha256(`misplaced|${p}`),
      });
    }
    const top = p.split('/')[0];
    if (!byDir.has(top)) byDir.set(top, new Set());
    byDir.get(top).add(path.extname(p).toLowerCase());
  }

  for (const [dir, exts] of byDir.entries()) {
    const codeExts = [...exts].filter((e) => SOURCE_EXT.has(e));
    if (codeExts.length >= 3 && dir && dir !== '.' && !dir.startsWith('.')) {
      findings.push({
        type: 'mixed_language_directory',
        path: dir,
        message: `Directory mixes multiple source languages: ${codeExts.sort().join(',')}`,
        severity: 'low',
        confidence: 'MEDIUM',
        evidence: ['extension_inventory'],
        scope: dir,
        fingerprint: sha256(`mixed|${dir}|${[...codeExts].sort().join(',')}`),
      });
    }
  }

  const importedTargets = new Set(
    dependency_edges.filter((e) => e.kind === 'import').map((e) => e.to)
  );
  const exportFiles = new Set(exports.map((e) => e.file));
  for (const f of files) {
    if (!SOURCE_EXT.has(path.extname(f.path))) continue;
    if (f.path.includes('/tests/') || /\.(test|spec)\./i.test(f.path)) continue;
    if (path.basename(f.path).startsWith('index.')) continue;
    if (exportFiles.has(f.path) && !importedTargets.has(f.path)) {
      // Only flag if file has exports and nothing imports it — candidate orphan
      const hasExport = exports.some((e) => e.file === f.path);
      if (hasExport) {
        findings.push({
          type: 'unreferenced_export_file_candidate',
          path: f.path,
          message: 'File exports symbols but no in-repo import edge was found (candidate)',
          severity: 'low',
          confidence: 'LOW',
          evidence: ['import_graph'],
          scope: f.path,
          fingerprint: sha256(`orphan_export|${f.path}`),
          candidate: true,
          note: 'Unreferenced does not mean safe to delete',
        });
      }
    }
  }

  // Exact declaration name duplicates across files (structural duplication candidates)
  const byName = new Map();
  for (const d of declarations) {
    if (d.kind !== 'function' && d.kind !== 'class') continue;
    const key = `${d.kind}:${d.name}`;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(d.file);
  }
  for (const [key, paths] of byName.entries()) {
    const unique = [...new Set(paths)].sort();
    if (unique.length > 1) {
      findings.push({
        type: 'duplicate_declaration_name_candidate',
        path: unique[0],
        message: `Same ${key} appears in multiple files (structural candidate)`,
        severity: 'low',
        confidence: 'MEDIUM',
        evidence: ['declaration_index', ...unique],
        scope: unique.join(','),
        fingerprint: sha256(`dupdecl|${key}|${unique.join('|')}`),
        candidate: true,
      });
    }
  }

  // High fan-in coupling signal
  const fanIn = new Map();
  for (const e of dependency_edges) {
    if (!e.to) continue;
    fanIn.set(e.to, (fanIn.get(e.to) || 0) + 1);
  }
  for (const [target, count] of fanIn.entries()) {
    if (count >= 8) {
      findings.push({
        type: 'high_structural_coupling',
        path: target,
        message: `File has high import fan-in (${count})`,
        severity: 'medium',
        confidence: 'MEDIUM',
        evidence: ['import_graph', `fan_in=${count}`],
        scope: target,
        fingerprint: sha256(`coupling|${target}|${count}`),
      });
    }
  }

  return findings;
}

export function createForgeOsStructuralAdapter(overrides = {}) {
  const adapter = {
    id: FORGEOS_STRUCTURAL_ID,
    name: 'ForgeOS Structural Analyzer',
    version: FORGEOS_STRUCTURAL_VERSION,
    schema: 'forgeos-intelligence-adapter',
    authority: 'intelligence_provider',
    claims_policy_authority: false,
    claims_project_intelligence_authority: false,
    claims_canvas_authority: false,
    may_mutate: false,
    may_execute: false,
    capabilities: [
      'files',
      'languages',
      'imports',
      'exports',
      'declarations',
      'symbols',
      'dependency_edges',
      'structural_findings',
      'change_impact_inputs',
    ],
    supported_languages: ['javascript', 'typescript'],
    packaging: 'bundled_zero_dependency',

    health() {
      return {
        status: 'available',
        packaging: 'bundled_zero_dependency',
        detail: 'Pure Node deterministic structural analysis',
      };
    },

    canAnalyze(projectContext = {}) {
      const ctx = createProjectContext(projectContext);
      if (!ctx.project_dir) {
        return { ok: false, reason: 'project_dir_required' };
      }
      if (!fs.existsSync(ctx.project_dir)) {
        return { ok: false, reason: 'project_dir_missing' };
      }
      return { ok: true, reason: 'project_readable' };
    },

    analyze(projectContext = {}) {
      const can = this.canAnalyze(projectContext);
      if (!can.ok) return unavailableAnalyzeResult(can.reason);

      const ctx = createProjectContext(projectContext);
      const root = path.resolve(ctx.project_dir);
      const walked = walkProject(root, { maxFiles: ctx.max_files });
      const filesList = (ctx.files.length ? ctx.files : walked.files)
        .map((f) => f.replace(/\\/g, '/'))
        .sort();

      const fileSet = new Set(filesList);
      const fileRecords = [];
      const fileFingerprints = [];
      const languages = new Set();
      const imports = [];
      const exports = [];
      const declarations = [];
      const symbols = [];
      const diagnostics = [];
      const dependency_edges = [];

      for (const rel of filesList) {
        const ext = path.extname(rel).toLowerCase();
        const language = detectLanguage(rel);
        const full = path.join(root, rel);
        let content = '';
        let size = 0;
        try {
          const stat = fs.statSync(full);
          size = stat.size;
          if (size <= ctx.max_file_bytes && SOURCE_EXT.has(ext) && !SKIP_PARSE_BASENAMES.has(path.basename(rel))) {
            content = fs.readFileSync(full, 'utf8');
          }
        } catch {
          diagnostics.push({
            file: rel,
            code: 'read_failed',
            message: 'Could not read file',
            severity: 'low',
          });
        }

        const fp = content ? sha256(content) : sha256(`${rel}|${size}`);
        fileFingerprints.push({ path: rel, sha256: fp });
        fileRecords.push({
          path: rel,
          language: language || null,
          size,
          examined: Boolean(content),
        });

        if (!content || !language) continue;
        languages.add(language);
        const parsed = analyzeSourceText(rel, content);
        imports.push(...parsed.imports);
        exports.push(...parsed.exports);
        declarations.push(...parsed.declarations);
        symbols.push(...parsed.symbols);
        diagnostics.push(...parsed.diagnostics);

        for (const imp of parsed.imports) {
          const resolved = resolveImportPath(rel, imp.source, fileSet);
          dependency_edges.push({
            from: rel,
            to: resolved || imp.source,
            kind: resolved ? 'import' : 'external',
            source: imp.source,
          });
        }
      }

      const findings = buildFindings({
        files: fileRecords,
        imports,
        exports,
        dependency_edges,
        declarations,
      });

      const inputFingerprint = sha256(
        filesList.map((f) => {
          const hit = fileFingerprints.find((x) => x.path === f);
          return `${f}:${hit?.sha256 || ''}`;
        }).join('|')
      );

      const raw = {
        files: fileRecords,
        languages: [...languages],
        imports,
        exports,
        declarations,
        symbols,
        diagnostics,
        dependency_edges,
        findings,
        input_fingerprint: inputFingerprint,
        file_fingerprints: fileFingerprints,
      };

      return {
        ok: true,
        status: 'ok',
        reason: null,
        raw,
        evidence_class: fileRecords.some((f) => f.examined) ? 'deterministic' : 'insufficient',
      };
    },

    normalize(result, context = {}) {
      if (!result || result.ok === false || !result.raw) {
        return createStructuralFacts({
          analyzer: { id: this.id, name: this.name, version: this.version },
          project_fingerprint: context.project_fingerprint || null,
          evidence_class: 'insufficient',
          status: 'unavailable',
          reason: result?.reason || 'normalize_without_raw',
          analyzed_at: context.analyzed_at,
        });
      }

      const raw = result.raw;
      return createStructuralFacts({
        analyzer: { id: this.id, name: this.name, version: this.version },
        project_fingerprint: context.project_fingerprint || null,
        input_fingerprint: raw.input_fingerprint,
        evidence_class: result.evidence_class || 'deterministic',
        languages: raw.languages,
        files: raw.files,
        symbols: raw.symbols,
        declarations: raw.declarations,
        references: [],
        imports: raw.imports,
        exports: raw.exports,
        dependency_edges: raw.dependency_edges,
        structural_edges: [],
        diagnostics: raw.diagnostics,
        findings: raw.findings,
        evidence: {
          file_fingerprints: raw.file_fingerprints,
          notes: ['forgeos-structural pure-node deterministic extraction'],
        },
        status: 'ok',
        analyzed_at: context.analyzed_at,
      });
    },

    ...overrides,
  };

  const validation = validateIntelligenceAdapter(adapter);
  return { ...adapter, validation };
}

export function getForgeOsStructuralAdapter() {
  return createForgeOsStructuralAdapter();
}
