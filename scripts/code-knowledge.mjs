import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { canonicalWorkspace, canonicalFile, prepareWorkspaceOutput } from './workspace-paths.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { analyzeCodebase } from './code-intelligence.mjs';

const slash = value => value.split(path.sep).join('/');
function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
    ? slash(relative) : null;
}
function location(root, node) {
  const source = node.getSourceFile();
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    file: inside(root, source.fileName),
    line: pos.line + 1,
    column: pos.character + 1,
  };
}
function canonicalSymbol(checker, symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}
function definitionKey(root, symbol) {
  const positions = (symbol.declarations ?? []).map(declaration => {
    const loc = location(root, declaration);
    return [loc.file ?? '@external', loc.line, loc.column, ts.SyntaxKind[declaration.kind]].join(':');
  }).sort();
  return positions.length ? positions.join('|') : 'unresolved-symbol:' + symbol.getName();
}
function typeLabel(checker, node) {
  // Type display is explanatory, never used as proof of symbol identity.
  const label = checker.typeToString(checker.getTypeAtLocation(node));
  return { text: label.slice(0, 300), truncated: label.length > 300 };
}

export async function queryCodeKnowledge({
  root = process.cwd(), config = 'tsconfig.json', symbol, definitionFile = null, impact = null,
} = {}) {
  if (typeof symbol !== 'string' || !symbol.trim()) throw new Error('A nonempty --symbol is required');
  const workspace = canonicalWorkspace(root);
  const chosenFile = definitionFile === null ? null : inside(workspace, canonicalFile(workspace, definitionFile, 'Definition file'));

  // The analysis pass already creates a TypeScript Program; share its exact snapshot.
  // A second createProgram would re-read, parse, and type-check the same project.
  let program = null;
  const analysis = await analyzeCodebase({
    root: workspace, config, impact,
    onProgram: compiled => { program = compiled; },
  });
  if (!program) throw new Error('Compiler analysis did not produce a TypeScript program');
  const checker = program.getTypeChecker();
  const sourceFiles = program.getSourceFiles().filter(file =>
    !file.isDeclarationFile && inside(workspace, file.fileName) && !slash(file.fileName).includes('/node_modules/'));
  const groups = new Map();
  let unmatchedBindings = 0;
  function visit(node) {
    if (ts.isIdentifier(node) && node.text === symbol) {
      const source = node.getSourceFile();
      const binding = checker.getSymbolAtLocation(node);
      if (!binding) {
        unmatchedBindings++;
      } else {
        const canonical = canonicalSymbol(checker, binding);
        const declarations = (canonical.declarations ?? []).map(declaration => ({
          ...location(workspace, declaration),
          kind: ts.SyntaxKind[declaration.kind],
        })).sort((a, b) => (a.file ?? '').localeCompare(b.file ?? '') || a.line - b.line || a.column - b.column);
        if (chosenFile === null || declarations.some(declaration => declaration.file === chosenFile)) {
          const identity = definitionKey(workspace, canonical);
          const key = createHash('sha256').update(identity).digest('hex').slice(0, 20);
          if (!groups.has(key)) groups.set(key, { identity: key, name: canonical.getName(), declarations, occurrences: [] });
          const parent = node.parent;
          const declaration = (canonical.declarations ?? []).some(decl => decl.name === node);
          const at = location(workspace, node);
          groups.get(key).occurrences.push({
            ...at, role: declaration ? 'definition' : 'reference',
            syntax: ts.SyntaxKind[parent?.kind ?? node.kind],
            type: typeLabel(checker, node),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  for (const file of sourceFiles) visit(file);
  const bindings = [...groups.values()].map(group => ({
    ...group,
    occurrences: group.occurrences.sort((a, b) => (a.file ?? '').localeCompare(b.file ?? '') || a.line - b.line || a.column - b.column),
  })).sort((a, b) => a.identity.localeCompare(b.identity));
  const matchedOccurrences = bindings.reduce((total, group) => total + group.occurrences.length, 0);
  return {
    schema_version: '1.0.0', operation: 'typescript_symbol_knowledge',
    query: { symbol, definition_file: chosenFile },
    scope: analysis.scope,
    findings: {
      binding_count: bindings.length,
      matched_occurrences: matchedOccurrences,
      unresolved_identifiers: unmatchedBindings,
      ambiguous_name: bindings.length > 1,
      symbol_found: bindings.length > 0,
      compiler_diagnostics: analysis.findings.diagnostic_count,
      unresolved_imports: analysis.findings.unresolved_import_count,
      dynamic_unknown_imports: analysis.findings.dynamic_unknown_count,
    },
    bindings,
    impact: analysis.impact,
    diagnostics: analysis.diagnostics,
    limitations: [
      'Matches identifiers by exact spelling within files included by the configured TypeScript program.',
      'Identifiers with identical spelling but different checker symbols are grouped separately; no ambiguous binding is guessed.',
      'Nonliteral dynamic imports, project files outside this tsconfig and runtime reflection are not fully resolved.',
      'Compiler semantics and source references are not proof of runtime execution or deployment.',
    ],
  };
}

function parseCli(args) {
  const options = { root: process.cwd(), config: 'tsconfig.json', symbol: null, definitionFile: null, impact: null, out: null, failOnDiagnostics: false };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    const name = key === '--definition-file' ? 'definitionFile' : key.slice(2);
    if (['--root', '--config', '--symbol', '--definition-file', '--impact', '--out'].includes(key)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(key + ' requires a value');
      options[name] = args[++i];
    } else if (key === '--fail-on-diagnostics') options.failOnDiagnostics = true;
    else throw new Error('Unknown argument: ' + key);
  }
  if (!options.symbol) throw new Error('--symbol is required');
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const options = parseCli(process.argv.slice(2));
    const result = await queryCodeKnowledge(options);
    const json = JSON.stringify(result, null, 2) + '\n';
    if (options.out) {
      const destination = await prepareWorkspaceOutput(canonicalWorkspace(options.root), options.out);
      await writeFile(destination, json);
    }
    process.stdout.write(json);
    if (!result.findings.symbol_found || result.findings.unresolved_identifiers ||
        (options.failOnDiagnostics && result.findings.compiler_diagnostics > 0)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write('code-knowledge: ' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}
