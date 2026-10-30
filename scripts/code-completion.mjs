import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { resolveCompletion } from './code-completion-resolve.mjs';

const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const unix = value => value.split(path.sep).join('/');

function localFile(root, requested, label) {
  if (!requested || typeof requested !== 'string') throw new Error(`${label} is required`);
  const absolute = path.resolve(root, requested);
  if (!within(root, absolute)) throw new Error(`${label} must remain inside workspace`);
  const actual = fs.realpathSync(absolute);
  if (!within(root, actual)) throw new Error(`${label} resolves outside workspace`);
  if (!fs.statSync(actual).isFile()) throw new Error(`${label} must be a regular file`);
  return actual;
}

/** Read-only compiler-backed completions in a real configured TS/JS project. */
export function completeCode({ root = process.cwd(), config = 'tsconfig.json', file, line, column, limit = 40, prefix = '', resolveName = null, resolveSource = null } = {}) {
  const workspace = fs.realpathSync(path.resolve(root));
  const configuration = localFile(workspace, config, 'tsconfig');
  const target = localFile(workspace, file, 'target file');
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) {
    throw new Error('line and column must be positive 1-based integers');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100');
  if (typeof prefix !== 'string' || prefix.length > 128) throw new Error('prefix must be at most 128 characters');
  if (resolveSource !== null && resolveName === null) throw new Error('resolve-source requires resolve-name');

  const configFile = ts.readConfigFile(configuration, ts.sys.readFile);
  if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configuration), undefined, configuration);
  if (parsed.errors.length) throw new Error(parsed.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; '));
  if (!parsed.fileNames.some(name => path.resolve(name) === target || (fs.existsSync(name) && fs.realpathSync(name) === target))) {
    throw new Error('target file is not included in the TypeScript project');
  }

  const content = fs.readFileSync(target, 'utf8');
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') starts.push(i + 1);
  if (line > starts.length) throw new Error('line is outside the target file');
  const start = starts[line - 1];
  const end = line < starts.length ? starts[line] - 1 : content.length;
  const visibleEnd = end > start && content[end - 1] === '\r' ? end - 1 : end;
  if (column > visibleEnd - start + 1) throw new Error('column is outside the requested line');
  const position = start + column - 1;

  const host = {
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: () => '0',
    getScriptSnapshot: filename => {
      const source = ts.sys.readFile(filename);
      return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
    },
    getCurrentDirectory: () => workspace,
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getProjectReferences: () => parsed.projectReferences,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  try {
    const result = service.getCompletionsAtPosition(target, position, {
      includeCompletionsForModuleExports: true,
      includeCompletionsWithInsertText: true,
      includeCompletionsForImportStatements: true,
    });
    const matches = (result?.entries ?? []).filter(entry => entry.name.toLowerCase().startsWith(prefix.toLowerCase()));
    const entries = matches.slice(0, limit).map(entry => ({
      name: entry.name,
      kind: entry.kind,
      insert_text: entry.insertText ?? entry.name,
      source: entry.source ?? null,
      is_snippet: Boolean(entry.isSnippet),
      requires_code_action: Boolean(entry.hasAction),
      replacement_span: entry.replacementSpan ?? result?.optionalReplacementSpan ?? null,
    }));
    const resolution = resolveName === null ? null : resolveCompletion({
      service, workspace, file: target, position, entries: matches, name: resolveName, source: resolveSource,
    });
    return {
      schema_version: '1.1.0',
      operation: 'typescript_language_service_completion',
      file: unix(path.relative(workspace, target)),
      cursor: { line, column, offset: position },
      compiler_version: ts.version,
      total_matching: matches.length,
      returned: entries.length,
      is_incomplete: result?.isIncomplete ?? false,
      entries,
      ...(resolution === null ? {} : { resolution }),
      limitations: [
        'Suggestions only; no source files are modified.',
        'An entry requiring a code action may also need import edits and must not be inserted alone.',
        'Use --resolve-name to retrieve compiler documentation and full workspace-scoped import edit previews; code actions are not applied.',
        'Actions containing commands or out-of-workspace edits need an authorized integration and cannot be treated as directly applicable.',
        'Completions reflect configured TypeScript/JavaScript project symbols, not AI-generated implementations or validated patches.',
      ],
    };
  } finally {
    service.dispose();
  }
}

function parseCli(args) {
  const values = { root: process.cwd(), config: 'tsconfig.json', limit: 40, prefix: '', resolveName: null, resolveSource: null };
  const supported = new Set(['root', 'config', 'file', 'line', 'column', 'limit', 'prefix', 'resolve-name', 'resolve-source']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const name = flag.startsWith('--') ? flag.slice(2) : '';
    if (!supported.has(name)) throw new Error(`Unknown argument: ${flag}`);
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Error(`${flag} requires a value`);
    const value = args[++i];
    const key = name === 'resolve-name' ? 'resolveName' : name === 'resolve-source' ? 'resolveSource' : name;
    values[key] = ['line', 'column', 'limit'].includes(name) ? Number(value) : value;
  }
  return values;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.stdout.write(`${JSON.stringify(completeCode(parseCli(process.argv.slice(2))), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`code-completion: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
