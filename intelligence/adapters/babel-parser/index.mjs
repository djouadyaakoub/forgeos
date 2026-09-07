/**
 * OSS-derived @babel/parser intelligence adapter — Stage 19
 *
 * Optional in-process parse-only provider.
 * Produces existing StructuralFacts. Never Policy / PI / Canvas / execution authority.
 *
 * Default ForgeOS install remains valid without this package.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { walkProject } from '../../structure/analyzer.mjs';
import {
  validateIntelligenceAdapter,
  createProjectContext,
  unavailableAnalyzeResult,
} from '../adapter.mjs';
import { createStructuralFacts } from '../structural-facts.mjs';
import {
  SOURCE_EXT,
  SKIP_PARSE_BASENAMES,
  sha256,
  detectLanguage,
  resolveImportPath,
  buildFindings,
} from '../forgeos-structural/index.mjs';
import {
  normalizeOssDerivedCapability,
} from '../../capability/oss-derived.mjs';
import { IMPLEMENTATION_KINDS } from '../../capability/implementation-kinds.mjs';
import { extractStructuralFromAst, babelParseOptions } from './extract.mjs';

const requireFromAdapter = createRequire(fileURLToPath(import.meta.url));

export const BABEL_PARSER_ADAPTER_ID = 'babel-parser';
export const BABEL_PARSER_PACKAGE = '@babel/parser';
export const BABEL_PARSER_PINNED_VERSION = '7.29.8';
export const BABEL_PARSER_ADAPTER_VERSION = '1.0.0-stage19';

export const BABEL_PARSER_OSS_SOURCE = Object.freeze({
  kind: 'oss',
  project: 'babel/babel',
  package: BABEL_PARSER_PACKAGE,
  license: 'MIT',
  version: BABEL_PARSER_PINNED_VERSION,
  version_or_reference: BABEL_PARSER_PINNED_VERSION,
  provenance: 'npm:@babel/parser@7.29.8 (MIT); babel/babel packages/babel-parser; optional load — not a Core required dependency; not @babel/core',
});

/**
 * Optional synchronous load. Never a static Core import.
 */
export function tryLoadBabelParser(requireFn = requireFromAdapter) {
  try {
    const mod = requireFn(BABEL_PARSER_PACKAGE);
    const parse = typeof mod.parse === 'function'
      ? mod.parse
      : (typeof mod.default?.parse === 'function' ? mod.default.parse : null);
    if (typeof parse !== 'function') {
      return {
        available: false,
        parse: null,
        version: null,
        reason: 'parse_export_missing',
      };
    }
    let version = null;
    try {
      version = requireFn(`${BABEL_PARSER_PACKAGE}/package.json`).version;
    } catch {
      version = null;
    }
    return { available: true, parse, version, reason: null };
  } catch (err) {
    const code = err?.code;
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
      return {
        available: false,
        parse: null,
        version: null,
        reason: 'module_not_installed',
      };
    }
    return {
      available: false,
      parse: null,
      version: null,
      reason: 'module_load_failed',
    };
  }
}

export function babelParserOssDerivedDescriptor(loaded = {}) {
  return normalizeOssDerivedCapability({
    capability_id: 'structural-ast-analysis',
    implementation_kind: IMPLEMENTATION_KINDS.OSS_DERIVED,
    source: {
      ...BABEL_PARSER_OSS_SOURCE,
      version: loaded.version || BABEL_PARSER_PINNED_VERSION,
      version_or_reference: loaded.version || BABEL_PARSER_PINNED_VERSION,
    },
    execution: { mode: 'forgeos_native' },
    authority: { policy: 'forgeos', verification: 'forgeos' },
    launches_external_runtime: false,
  });
}

/**
 * Parse a single source string. Throws nothing to the caller — returns diagnostics.
 */
export function analyzeSourceTextWithBabel(filePath, content, parseFn) {
  const language = detectLanguage(filePath);
  if (!language || typeof parseFn !== 'function') {
    return {
      language,
      imports: [],
      exports: [],
      declarations: [],
      symbols: [],
      diagnostics: typeof parseFn !== 'function'
        ? [{
          file: filePath,
          code: 'babel_parser_unavailable',
          message: 'Babel parser function missing',
          severity: 'medium',
        }]
        : [],
      parse_ok: false,
    };
  }

  try {
    const ast = parseFn(content, babelParseOptions(filePath));
    const extracted = extractStructuralFromAst(ast, filePath, language);
    return { ...extracted, parse_ok: true };
  } catch (err) {
    const loc = err?.loc || {};
    return {
      language,
      imports: [],
      exports: [],
      declarations: [],
      symbols: [],
      parse_ok: false,
      diagnostics: [{
        file: filePath,
        code: 'babel_parse_error',
        message: String(err?.message || 'parse_failed').split('\n')[0],
        severity: 'medium',
        line: loc.line || 0,
        column: loc.column,
      }],
    };
  }
}

export function createBabelParserAdapter(overrides = {}) {
  const loaded = overrides.parserLoad || tryLoadBabelParser(overrides.requireFn);
  const ossDerived = babelParserOssDerivedDescriptor(loaded);
  const analyzerVersion = loaded.available && loaded.version
    ? `${BABEL_PARSER_ADAPTER_VERSION}+babel-${loaded.version}`
    : `${BABEL_PARSER_ADAPTER_VERSION}-unavailable`;

  const adapter = {
    id: BABEL_PARSER_ADAPTER_ID,
    name: 'Babel Parser Structural Analyzer',
    version: analyzerVersion,
    schema: 'forgeos-intelligence-adapter',
    authority: 'intelligence_provider',
    claims_policy_authority: false,
    claims_project_intelligence_authority: false,
    claims_canvas_authority: false,
    may_mutate: false,
    may_execute: false,
    implementation_kind: IMPLEMENTATION_KINDS.OSS_DERIVED,
    execution_mode: 'forgeos_native',
    launches_external_runtime: false,
    packaging: 'optional_npm',
    oss_derived: ossDerived,
    capabilities: [
      'files',
      'languages',
      'imports',
      'exports',
      'declarations',
      'symbols',
      'dependency_edges',
      'structural_findings',
      'parse_diagnostics',
      'change_impact_inputs',
    ],
    supported_languages: ['javascript', 'typescript'],

    health() {
      if (!loaded.available) {
        return {
          status: 'unavailable',
          packaging: 'optional_npm',
          reason: loaded.reason || 'module_not_installed',
          detail: 'Optional @babel/parser not loaded — use forgeos-structural fallback',
          oss_derived: ossDerived,
        };
      }
      return {
        status: 'available',
        packaging: 'optional_npm',
        reason: null,
        detail: 'In-process @babel/parser (parse-only)',
        babel_version: loaded.version,
        oss_derived: ossDerived,
      };
    },

    canAnalyze(projectContext = {}) {
      if (!loaded.available) {
        return { ok: false, reason: loaded.reason || 'module_not_installed' };
      }
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
      if (!can.ok) {
        return unavailableAnalyzeResult(can.reason, {
          note: 'No fabricated Babel AST',
        });
      }

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
        const parsed = analyzeSourceTextWithBabel(rel, content, loaded.parse);
        diagnostics.push(...parsed.diagnostics);
        if (!parsed.parse_ok) continue;
        imports.push(...parsed.imports);
        exports.push(...parsed.exports);
        declarations.push(...parsed.declarations);
        symbols.push(...parsed.symbols);

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
        babel_version: loaded.version,
        provider: BABEL_PARSER_ADAPTER_ID,
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
          evidence: {
            notes: [
              'babel-parser optional provider unavailable or analyze failed',
              result?.reason || 'normalize_without_raw',
            ],
          },
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
          notes: [
            'oss_derived @babel/parser parse-only',
            `babel_version=${raw.babel_version || 'unknown'}`,
            'not_policy_authority',
            'not_verification_pass',
            'not_canvas_satisfied',
          ],
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

export function getBabelParserAdapter() {
  return createBabelParserAdapter();
}
