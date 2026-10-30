import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
export function completeCode({ root = process.cwd(), config = 'tsconfig.json', file, line, column, limit = 40, prefix = '', details = false, diagnostics = false } = {}) {
  const workspace = fs.realpathSync(path.resolve(root));
  const configuration = localFile(workspace, config, 'tsconfig');
  const target = localFile(workspace, file, 'target file');
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) {
    throw new Error('line and column must be positive 1-based integers');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100');
  if (typeof prefix !== 'string' || prefix.length > 128) throw new Error('prefix must be at most 128 characters');
  if (typeof details !== 'boolean' || typeof diagnostics !== 'boolean') throw new Error('details and diagnostics must be booleans');

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
    // Fetch expensive TypeScript detail/auto-import actions only for the bounded, returned page.
    // Actions are proposals: no edits are applied and no outside-workspace edit is advertised as safe.
    function relativeEditFile(filename) {
      const absolute = path.resolve(filename);
      if (!within(workspace, absolute)) return null;
      try {
        const actual = fs.existsSync(absolute) ? fs.realpathSync(absolute) : path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
        return within(workspace, actual) ? unix(path.relative(workspace, actual)) : null;
      } catch {
        return null;
      }
    }
    const entries = matches.slice(0, limit).map(entry => {
      const suggestion = {
        name: entry.name,
        kind: entry.kind,
        insert_text: entry.insertText ?? entry.name,
        source: entry.source ?? null,
        is_snippet: Boolean(entry.isSnippet),
        requires_code_action: Boolean(entry.hasAction),
        replacement_span: entry.replacementSpan ?? result?.optionalReplacementSpan ?? null,
      };
      if (details) {
        const detail = service.getCompletionEntryDetails(target, position, entry.name, {}, entry.source, {}, entry.data);
        const codeActions = (detail?.codeActions ?? []).map(action => {
          const changes = (action.changes ?? []).map(change => {
            const filename = relativeEditFile(change.fileName);
            return {
              file: filename,
              inside_workspace: filename !== null,
              is_new_file: Boolean(change.isNewFile),
              edits: (change.textChanges ?? []).map(changeEdit => ({
                span: { start: changeEdit.span.start, length: changeEdit.span.length },
                new_text: changeEdit.newText,
              })),
            };
          });
          return {
            description: action.description,
            safe_workspace_scope: changes.every(change => change.inside_workspace),
            changes,
          };
        });
        suggestion.detail = {
          signature: detail ? ts.displayPartsToString(detail.displayParts ?? []) : null,
          documentation: detail ? ts.displayPartsToString(detail.documentation ?? []) : null,
          tags: (detail?.tags ?? []).map(tag => ({ name: tag.name, text: ts.displayPartsToString(tag.text ?? []) })),
          code_actions: codeActions,
          action_resolved: !entry.hasAction || codeActions.length > 0,
        };
      }
      return suggestion;
    });
    const checked = diagnostics
      ? [...service.getSyntacticDiagnostics(target), ...service.getSemanticDiagnostics(target)]
      : [];
    const diagnosticsList = checked.map(diagnostic => {
      const location = typeof diagnostic.start === 'number' && diagnostic.file
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : null;
      return {
        code: diagnostic.code,
        category: ts.DiagnosticCategory[diagnostic.category].toLowerCase(),
        file: diagnostic.file ? relativeEditFile(diagnostic.file.fileName) : null,
        line: location ? location.line + 1 : null,
        column: location ? location.character + 1 : null,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      };
    });
    return {
      schema_version: '1.0.0',
      operation: 'typescript_language_service_completion',
      file: unix(path.relative(workspace, target)),
      cursor: { line, column, offset: position },
      compiler_version: ts.version,
      total_matching: matches.length,
      returned: entries.length,
      is_incomplete: result?.isIncomplete ?? false,
      entries,
      detail_requested: details,
      diagnostic_count: diagnostics ? diagnosticsList.length : null,
      diagnostics: diagnostics ? diagnosticsList : null,
      limitations: [
        'Suggestions only; no source files are modified.',
        'An entry requiring a code action may also need import edits and must not be inserted alone.',
        'When --details is used, code actions are compiler-proposed text edits; verify their base revision and apply atomically using an editor, never blindly.',
        'Completions reflect configured TypeScript/JavaScript project symbols, not AI-generated implementations or validated patches.',
      ],
    };
  } finally {
    service.dispose();
  }
}

function parseCli(args) {
  const values = { root: process.cwd(), config: 'tsconfig.json', limit: 40, prefix: '', details: false, diagnostics: false, failOnDiagnostics: false };
  const supported = new Set(['root', 'config', 'file', 'line', 'column', 'limit', 'prefix']);
  const toggles = new Set(['details', 'diagnostics', 'fail-on-diagnostics']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const name = flag.startsWith('--') ? flag.slice(2) : '';
    if (toggles.has(name)) { values[name === 'fail-on-diagnostics' ? 'failOnDiagnostics' : name] = true; continue; }
    if (!supported.has(name)) throw new Error(`Unknown argument: ${flag}`);
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Error(`${flag} requires a value`);
    const value = args[++i];
    values[name] = ['line', 'column', 'limit'].includes(name) ? Number(value) : value;
  }
  if (values.failOnDiagnostics) values.diagnostics = true;
  return values;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const options = parseCli(process.argv.slice(2));
    const report = completeCode(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (options.failOnDiagnostics && report.diagnostic_count > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`code-completion: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
