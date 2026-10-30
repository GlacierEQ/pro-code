import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const normalize = value => value.split(path.sep).join('/');

function relativeWithin(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    ? normalize(relative)
    : null;
}

function diagnosticRecord(root, diagnostic) {
  const location = diagnostic.file && typeof diagnostic.start === 'number'
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    : null;
  return {
    code: diagnostic.code,
    category: ts.DiagnosticCategory[diagnostic.category].toLowerCase(),
    file: diagnostic.file ? relativeWithin(root, diagnostic.file.fileName) : null,
    line: location ? location.line + 1 : null,
    column: location ? location.character + 1 : null,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  };
}

function sourceImports(sourceFile) {
  const imports = [];
  const push = (specifier, kind, line) => imports.push({ specifier, kind, line });
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      push(node.moduleSpecifier.text, ts.isExportDeclaration(node) ? 're-export' : 'import', line);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      push(node.argument.literal.text, 'import-type', sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      if (expr && ts.isStringLiteralLike(expr)) push(expr.text, 'import-equals', sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    } else if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const isImport = expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(expression) && expression.text === 'require';
      const isRequireResolve = ts.isPropertyAccessExpression(expression)
        && ts.isIdentifier(expression.expression)
        && expression.expression.text === 'require'
        && expression.name.text === 'resolve';
      if (isImport || isRequire || isRequireResolve) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const firstArgument = node.arguments[0];
        const specifier = firstArgument && ts.isStringLiteralLike(firstArgument) ? firstArgument.text : null;
        push(specifier, isImport ? 'dynamic-import' : isRequireResolve ? 'require-resolve' : 'require', line);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return imports;
}

export async function analyzeCodebase({ root = process.cwd(), config = 'tsconfig.json', impact = null } = {}) {
  const workspaceRoot = path.resolve(root);
  const configuration = path.resolve(workspaceRoot, config);
  if (relativeWithin(workspaceRoot, configuration) === null) throw new Error('tsconfig must remain inside the workspace');
  const loaded = ts.readConfigFile(configuration, ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configuration), undefined, configuration);
  if (parsed.errors.length) throw new Error(parsed.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; '));
  if (!parsed.fileNames.length) throw new Error('TypeScript configuration contains no source files');
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences });
  const checker = program.getTypeChecker();
  const sourceFiles = program.getSourceFiles().filter(file => !file.isDeclarationFile && relativeWithin(workspaceRoot, file.fileName) !== null && !normalize(file.fileName).includes('/node_modules/'));
  const fileSet = new Set(sourceFiles.map(file => normalize(path.relative(workspaceRoot, file.fileName))));
  // Reuse TypeScript's module resolution cache across the entire dependency graph.
  // Repeated package and directory lookups otherwise multiply filesystem I/O.
  const resolutionCache = ts.createModuleResolutionCache(workspaceRoot, name => ts.sys.useCaseSensitiveFileNames ? name : name.toLowerCase(), parsed.options);
  const files = sourceFiles.map(file => {
    const filename = normalize(path.relative(workspaceRoot, file.fileName));
    const edges = sourceImports(file).map(item => {
      if (!item.specifier) return { ...item, kind: item.kind, status: 'dynamic-unknown', target: null };
      const resolution = ts.resolveModuleName(item.specifier, file.fileName, parsed.options, ts.sys, resolutionCache).resolvedModule;
      if (!resolution) return { ...item, status: 'unresolved', target: null };
      const target = relativeWithin(workspaceRoot, resolution.resolvedFileName);
      if (target && fileSet.has(target)) return { ...item, status: 'internal', target };
      // A declaration/source file inside the workspace but outside the indexed
      // program is not an external dependency and cannot be called complete.
      if (target !== null && target !== '') return { ...item, status: 'internal-unindexed', target };
      return { ...item, status: 'external', target: null };
    });
    const symbol = checker.getSymbolAtLocation(file);
    const exports = symbol ? checker.getExportsOfModule(symbol).map(sym => sym.getName()).sort() : [];
    return { path: filename, imports: edges, exports };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const diagnostics = ts.getPreEmitDiagnostics(program).map(item => diagnosticRecord(workspaceRoot, item)).sort((a, b) => (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0) || a.code - b.code);
  const reverse = new Map(files.map(file => [file.path, new Set()]));
  for (const file of files) for (const imp of file.imports) if (imp.status === 'internal') reverse.get(imp.target)?.add(file.path);
  let affected = null;
  let requested = null;
  if (impact !== null) {
    requested = normalize(path.relative(workspaceRoot, path.resolve(workspaceRoot, impact)));
    if (!fileSet.has(requested)) throw new Error(`Impact target is not included in the TypeScript program: ${requested}`);
    const visited = new Set([requested]);
    const queue = [requested];
    for (let index = 0; index < queue.length; index++) {
      const next = [...(reverse.get(queue[index]) ?? [])].sort();
      for (const dependent of next) if (!visited.has(dependent)) { visited.add(dependent); queue.push(dependent); }
    }
    affected = [...visited].sort();
  }
  const allImports = files.flatMap(file => file.imports.map(imp => ({ importer: file.path, ...imp })));
  const unresolvedCount = allImports.filter(imp => imp.status === 'unresolved').length;
  const dynamicUnknownCount = allImports.filter(imp => imp.status === 'dynamic-unknown').length;
  const unindexedInternalCount = allImports.filter(imp => imp.status === 'internal-unindexed').length;
  return {
    schema_version: '1.0.0', operation: 'typescript_program_analysis',
    scope: { workspace: workspaceRoot, tsconfig: normalize(path.relative(workspaceRoot, configuration)), compiler_version: ts.version, source_file_count: files.length, imports_checked: allImports.length, analysis_complete: unresolvedCount === 0 && dynamicUnknownCount === 0 && unindexedInternalCount === 0 && diagnostics.length === 0 },
    limitations: [
      'Dependency graph includes source files in the TypeScript program only, not every file in the repository.',
      'Resolved local declarations outside the indexed graph are explicitly marked internal-unindexed; impact results cannot claim coverage of their references.',
      'Non-literal import() and CommonJS require()/require.resolve() paths cannot be resolved statically; their presence is reported explicitly.',
      'CommonJS require-call detection is syntax-based and does not establish whether a locally shadowed require is the Node.js loader.',
      'Static diagnostics and dependency analysis are not proof of production behavior or safe deployment.',
    ],
    findings: { diagnostic_count: diagnostics.length, unresolved_import_count: unresolvedCount, dynamic_unknown_count: dynamicUnknownCount, unindexed_internal_import_count: unindexedInternalCount },
    diagnostics, files, impact: requested === null ? null : { target: requested, affected_files: affected },
  };
}

function parseCli(args) {
  const options = { root: process.cwd(), config: 'tsconfig.json', impact: null, out: null, failOnDiagnostics: false, failOnIncomplete: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--root' || arg === '--config' || arg === '--impact' || arg === '--out') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = args[++i];
    } else if (arg === '--fail-on-diagnostics') options.failOnDiagnostics = true;
    else if (arg === '--fail-on-incomplete') options.failOnIncomplete = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

const invokedFile = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedFile) {
  try {
    const options = parseCli(process.argv.slice(2));
    const result = await analyzeCodebase(options);
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (options.out) {
      const destination = path.resolve(options.root, options.out);
      if (relativeWithin(path.resolve(options.root), destination) === null) throw new Error('Output path must stay inside workspace');
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, json);
    }
    process.stdout.write(json);
    if ((options.failOnDiagnostics && result.findings.diagnostic_count > 0)
      || (options.failOnIncomplete && !result.scope.analysis_complete)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`code-intelligence: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
