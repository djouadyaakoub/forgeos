/**
 * Babel AST → StructuralFacts fields (parse-only).
 * Does not execute, transform, or resolve modules.
 */

function locLine(node) {
  return node?.loc?.start?.line || 0;
}

function stringLiteralValue(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

function bindingNames(id) {
  if (!id || typeof id !== 'object') return [];
  if (id.type === 'Identifier') return [id.name];
  if (id.type === 'RestElement') return bindingNames(id.argument);
  if (id.type === 'AssignmentPattern') return bindingNames(id.left);
  if (id.type === 'ObjectPattern') {
    const names = [];
    for (const p of id.properties || []) {
      if (p.type === 'RestElement') names.push(...bindingNames(p.argument));
      else if (p.type === 'ObjectProperty' || p.type === 'Property') {
        names.push(...bindingNames(p.value));
      }
    }
    return names;
  }
  if (id.type === 'ArrayPattern') {
    const names = [];
    for (const el of id.elements || []) names.push(...bindingNames(el));
    return names;
  }
  return [];
}

function specifierNames(specifiers = []) {
  const names = [];
  for (const s of specifiers) {
    if (s.type === 'ImportDefaultSpecifier') names.push(s.local?.name || 'default');
    else if (s.type === 'ImportNamespaceSpecifier') names.push(s.local?.name || '*');
    else if (s.type === 'ImportSpecifier') names.push(s.imported?.name || s.local?.name);
    else if (s.type === 'ExportSpecifier') names.push(s.exported?.name || s.local?.name);
  }
  return names.filter(Boolean).sort();
}

function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'range' || key === 'extra') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === 'object' && c.type) walk(c, visit, node);
      }
    } else if (child && typeof child === 'object' && child.type) {
      walk(child, visit, node);
    }
  }
}

function addDecl(declarations, symbols, filePath, language, name, kind, node) {
  if (!name) return;
  const line = locLine(node);
  declarations.push({ file: filePath, name, kind, line });
  symbols.push({ file: filePath, name, kind, language });
}

/**
 * Extract StructuralFacts-compatible arrays from a Babel AST.
 */
export function extractStructuralFromAst(ast, filePath, language) {
  const imports = [];
  const exports = [];
  const declarations = [];
  const symbols = [];
  const seenRequire = new Set();

  walk(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      const source = stringLiteralValue(node.source);
      if (source == null) return;
      imports.push({
        file: filePath,
        source,
        specifiers: specifierNames(node.specifiers),
        kind: 'import',
        line: locLine(node),
      });
      return;
    }

    if (node.type === 'ImportExpression') {
      const source = stringLiteralValue(node.source);
      if (source == null) return;
      imports.push({
        file: filePath,
        source,
        specifiers: [],
        kind: 'dynamic_import',
        line: locLine(node),
      });
      return;
    }

    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const isImport = callee?.type === 'Import';
      const isRequire = callee?.type === 'Identifier' && callee.name === 'require';
      if (!isImport && !isRequire) return;
      const arg = node.arguments?.[0];
      const source = stringLiteralValue(arg);
      if (source == null) return;
      const kind = isRequire ? 'require' : 'dynamic_import';
      const key = `${kind}|${source}|${locLine(node)}`;
      if (seenRequire.has(key)) return;
      seenRequire.add(key);
      imports.push({
        file: filePath,
        source,
        specifiers: [],
        kind,
        line: locLine(node),
      });
      return;
    }

    if (node.type === 'ExportAllDeclaration') {
      const source = stringLiteralValue(node.source);
      exports.push({
        file: filePath,
        name: '*',
        kind: 'star_export',
        line: locLine(node),
        source: source || null,
      });
      return;
    }

    if (node.type === 'ExportDefaultDeclaration') {
      exports.push({
        file: filePath,
        name: 'default',
        kind: 'default_export',
        line: locLine(node),
      });
      const decl = node.declaration;
      if ((decl?.type === 'FunctionDeclaration' || decl?.type === 'FunctionExpression') && !decl.id) {
        addDecl(declarations, symbols, filePath, language, 'default', 'function', decl);
      } else if ((decl?.type === 'ClassDeclaration' || decl?.type === 'ClassExpression') && !decl.id) {
        addDecl(declarations, symbols, filePath, language, 'default', 'class', decl);
      }
      return;
    }

    if (node.type === 'ExportNamedDeclaration') {
      if (node.source) {
        const source = stringLiteralValue(node.source);
        if (node.specifiers?.length) {
          for (const s of node.specifiers) {
            exports.push({
              file: filePath,
              name: s.exported?.name || s.local?.name || '*',
              kind: 're_export',
              line: locLine(node),
              source: source || null,
            });
          }
        } else {
          exports.push({
            file: filePath,
            name: '*',
            kind: 're_export',
            line: locLine(node),
            source: source || null,
          });
        }
      } else if (node.specifiers?.length) {
        for (const s of node.specifiers) {
          exports.push({
            file: filePath,
            name: s.exported?.name || s.local?.name,
            kind: 'named_export',
            line: locLine(node),
          });
        }
      }
      // Declarations on the export node are also visited as children.
      if (node.declaration && !node.source) {
        const d = node.declaration;
        if (d.type === 'FunctionDeclaration' && d.id?.name) {
          exports.push({
            file: filePath,
            name: d.id.name,
            kind: 'named_export',
            line: locLine(node),
          });
        } else if (d.type === 'ClassDeclaration' && d.id?.name) {
          exports.push({
            file: filePath,
            name: d.id.name,
            kind: 'named_export',
            line: locLine(node),
          });
        } else if (d.type === 'VariableDeclaration') {
          for (const dec of d.declarations || []) {
            for (const name of bindingNames(dec.id)) {
              exports.push({
                file: filePath,
                name,
                kind: 'named_export',
                line: locLine(node),
              });
            }
          }
        } else if (d.type === 'TSInterfaceDeclaration' && d.id?.name) {
          exports.push({
            file: filePath,
            name: d.id.name,
            kind: 'named_export',
            line: locLine(node),
          });
        } else if (d.type === 'TSTypeAliasDeclaration' && d.id?.name) {
          exports.push({
            file: filePath,
            name: d.id.name,
            kind: 'named_export',
            line: locLine(node),
          });
        } else if (d.type === 'TSEnumDeclaration' && d.id?.name) {
          exports.push({
            file: filePath,
            name: d.id.name,
            kind: 'named_export',
            line: locLine(node),
          });
        }
      }
      return;
    }

    if (node.type === 'FunctionDeclaration' && node.id?.name) {
      addDecl(declarations, symbols, filePath, language, node.id.name, 'function', node);
      return;
    }
    if (node.type === 'ClassDeclaration' && node.id?.name) {
      addDecl(declarations, symbols, filePath, language, node.id.name, 'class', node);
      return;
    }
    if (node.type === 'VariableDeclaration') {
      for (const dec of node.declarations || []) {
        for (const name of bindingNames(dec.id)) {
          addDecl(declarations, symbols, filePath, language, name, 'variable', node);
        }
      }
      return;
    }
    if (node.type === 'TSInterfaceDeclaration' && node.id?.name) {
      addDecl(declarations, symbols, filePath, language, node.id.name, 'interface', node);
      return;
    }
    if (node.type === 'TSTypeAliasDeclaration' && node.id?.name) {
      addDecl(declarations, symbols, filePath, language, node.id.name, 'type', node);
      return;
    }
    if (node.type === 'TSEnumDeclaration' && node.id?.name) {
      addDecl(declarations, symbols, filePath, language, node.id.name, 'enum', node);
    }
  });

  return { language, imports, exports, declarations, symbols, diagnostics: [] };
}

export function babelPluginsForExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === '.tsx') return ['typescript', 'jsx'];
  if (e === '.ts') return ['typescript'];
  if (e === '.jsx') return ['jsx'];
  return [];
}

export function babelParseOptions(filePath) {
  const ext = filePath.includes('.') ? filePath.slice(filePath.lastIndexOf('.')) : '';
  return {
    sourceType: 'unambiguous',
    errorRecovery: false,
    allowReturnOutsideFunction: false,
    plugins: babelPluginsForExt(ext),
    sourceFilename: filePath.replace(/\\/g, '/'),
  };
}
