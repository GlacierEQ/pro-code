import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { resolveCompletion, safeWorkspacePath } from './code-completion-resolve.mjs';

const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const unix = value => value.split(path.sep).join('/');

function workspaceRelative(root, filename) {
  return safeWorkspacePath(root, filename);
}

function completionActions(root, detail) {
  return (detail?.codeActions ?? []).map(action => ({
    description: action.description,
    requires_commands: Boolean(action.commands?.length),
    changes: (action.changes ?? []).map(change => {
      const file = workspaceRelative(root, change.fileName);
      return {
        file,
        within_workspace: file !== null,
        edits: file === null ? [] : change.textChanges.map(edit => ({
          span: edit.span, new_text: edit.newText,
        })),
      };
    }),
  }));
}

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
export function completeCode({
  root = process.cwd(), config = 'tsconfig.json', file, line, column,
  limit = 40, prefix = '', content, autoPrefix = false, includeDetails = false, includeDiagnostics = false,
  resolveName = null, resolveSource = null,
} = {}) {
  const workspace = fs.realpathSync(path.resolve(root));
  const configuration = localFile(workspace, config, 'tsconfig');
  const target = localFile(workspace, file, 'target file');
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) {
    throw new Error('line and column must be positive 1-based integers');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100');
  if (typeof prefix !== 'string' || prefix.length > 128) throw new Error('prefix must be at most 128 characters');
  if (resolveSource !== null && resolveName === null) throw new Error('resolve-source requires resolve-name');
  if (typeof autoPrefix !== 'boolean' || typeof includeDetails !== 'boolean' || typeof includeDiagnostics !== 'boolean') {
    throw new Error('autoPrefix, includeDetails and includeDiagnostics must be booleans');
  }
  if (content !== undefined && (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 2_097_152)) {
    throw new Error('content must be a UTF-8 string of at most 2 MiB');
  }

  const configFile = ts.readConfigFile(configuration, ts.sys.readFile);
  if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configuration), undefined, configuration);
  if (parsed.errors.length) throw new Error(parsed.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; '));
  if (!parsed.fileNames.some(name => path.resolve(name) === target || (fs.existsSync(name) && fs.realpathSync(name) === target))) {
    throw new Error('target file is not included in the TypeScript project');
  }

  const diskContent = fs.readFileSync(target, 'utf8');
  const source = content === undefined ? diskContent : content;
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  if (line > starts.length) throw new Error('line is outside the target file');
  const start = starts[line - 1];
  const end = line < starts.length ? starts[line] - 1 : source.length;
  const visibleEnd = end > start && source[end - 1] === '\r' ? end - 1 : end;
  if (column > visibleEnd - start + 1) throw new Error('column is outside the requested line');
  const position = start + column - 1;
  const inferredPrefix = autoPrefix ? source.slice(start, position).match(/[\p{ID_Continue}$]*$/u)?.[0] ?? '' : prefix;
  if (inferredPrefix.length > 128) throw new Error('inferred prefix exceeds 128 characters');

  const host = {
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: filename => path.resolve(filename) === target && content !== undefined ? '1' : '0',
    getScriptSnapshot: filename => {
      if (path.resolve(filename) === target && content !== undefined) {
        return ts.ScriptSnapshot.fromString(content);
      }
      const fileContent = ts.sys.readFile(filename);
      return fileContent === undefined ? undefined : ts.ScriptSnapshot.fromString(fileContent);
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
    const matches = (result?.entries ?? []).filter(entry => entry.name.toLowerCase().startsWith(inferredPrefix.toLowerCase()));
    const entries = matches.slice(0, limit).map(entry => {
      const detail = includeDetails
        ? service.getCompletionEntryDetails(target, position, entry.name, {}, entry.source, {}, entry.data)
        : undefined;
      return {
        name: entry.name,
        kind: entry.kind,
        insert_text: entry.insertText ?? entry.name,
        source: entry.source ?? null,
        is_snippet: Boolean(entry.isSnippet),
        requires_code_action: Boolean(entry.hasAction),
        replacement_span: entry.replacementSpan ?? result?.optionalReplacementSpan ?? null,
        ...(includeDetails ? {
          display_text: ts.displayPartsToString(detail?.displayParts ?? []),
          documentation: ts.displayPartsToString(detail?.documentation ?? []),
          tags: (detail?.tags ?? []).map(tag => ({ name: tag.name, text: ts.displayPartsToString(tag.text ?? []) })),
          code_actions: completionActions(workspace, detail),
        } : {}),
      };
    });
    const diagnostics = includeDiagnostics
      ? [...service.getSyntacticDiagnostics(target), ...service.getSemanticDiagnostics(target)].map(d => {
        const where = d.file && Number.isInteger(d.start) ? d.file.getLineAndCharacterOfPosition(d.start) : null;
        return {
          code: d.code,
          category: ts.DiagnosticCategory[d.category].toLowerCase(),
          message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
          line: where ? where.line + 1 : null,
          column: where ? where.character + 1 : null,
        };
      }).sort((left, right) => (left.line ?? 0) - (right.line ?? 0)
        || (left.column ?? 0) - (right.column ?? 0) || left.code - right.code)
      : null;
    const resolution = resolveName === null ? null : resolveCompletion({
      service, workspace, file: target, position, entries: matches, name: resolveName, source: resolveSource,
    });
    return {
      schema_version: '1.1.0',
      operation: 'typescript_language_service_completion',
      file: unix(path.relative(workspace, target)),
      cursor: { line, column, offset: position },
      compiler_version: ts.version,
      source_kind: content === undefined ? 'disk' : 'editor-buffer',
      is_dirty: content !== undefined && content !== diskContent,
      prefix_used: inferredPrefix,
      details_included: includeDetails,
      total_matching: matches.length,
      returned: entries.length,
      is_incomplete: result?.isIncomplete ?? false,
      entries,
      ...(resolution === null ? {} : { resolution }),
      ...(includeDiagnostics ? { diagnostics } : {}),
      limitations: [
        'Suggestions and suggested code actions are read-only; no source files are modified.',
        'Editor-buffer completions use a transient unsaved snapshot of the target file; other project files are read from disk.',
        'Code actions may require coordinated edits; actions targeting files outside the workspace are disclosed without edit text.',
        'An entry requiring a code action may also need import edits and must not be inserted alone.',
        'Completions reflect configured TypeScript/JavaScript project symbols, not AI-generated implementations or validated patches.',
        'Use --resolve-name to retrieve compiler documentation and complete import edit previews; code actions are not applied.',
        'Code action commands are not executed; out-of-workspace edits are suppressed.',
      ],
    };
  } finally {
    service.dispose();
  }
}

function parseCli(args) {
  const values = { root: process.cwd(), config: 'tsconfig.json', limit: 40, prefix: '', autoPrefix: false, includeDetails: false, includeDiagnostics: false, resolveName: null, resolveSource: null };
  const supported = new Set(['root', 'config', 'file', 'line', 'column', 'limit', 'prefix', 'resolve-name', 'resolve-source']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--auto-prefix') { values.autoPrefix = true; continue; }
    if (flag === '--details') { values.includeDetails = true; continue; }
    if (flag === '--diagnostics') { values.includeDiagnostics = true; continue; }
    if (flag === '--content-stdin') { values.content = fs.readFileSync(0, 'utf8'); continue; }
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
