import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { commitGuardedFiles } from './refactor-transaction.mjs';

const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const slash = value => value.split(path.sep).join('/');
function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
function secureFile(root, filename, label) {
  if (typeof filename !== 'string' || !filename) throw new Error(`${label} is required`);
  const lexical = path.resolve(root, filename);
  if (!inside(root, lexical)) throw new Error(`${label} escapes workspace`);
  const canonical = fs.realpathSync(lexical);
  if (!inside(root, canonical) || !fs.statSync(canonical).isFile()) throw new Error(`${label} is not a regular workspace file`);
  return canonical;
}
function diagnosticKey(item, root) {
  const file = item.file ? slash(path.relative(root, item.file.fileName)) : '<project>';
  return [file, item.code, ts.flattenDiagnosticMessageText(item.messageText, '\n')].join('|');
}
function diagnose(program, root) {
  const counts = new Map();
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const key = diagnosticKey(d, root);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
function additionalDiagnostics(previous, next) {
  const introduced = [];
  for (const [key, count] of next) if (count > (previous.get(key) ?? 0)) introduced.push({ diagnostic: key, added: count - (previous.get(key) ?? 0) });
  return introduced;
}
function createProject(root, config, replacements = new Map()) {
  const configPath = secureFile(root, config, 'tsconfig');
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configPath), undefined, configPath);
  if (parsed.errors.length) throw new Error(parsed.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; '));
  if (!parsed.fileNames.length) throw new Error('TypeScript project contains no files');
  const scriptFiles = parsed.fileNames.map(f => secureFile(root, f, 'project source'));
  const options = parsed.options;
  const host = {
    getScriptFileNames: () => scriptFiles,
    getScriptVersion: name => replacements.has(path.resolve(name)) ? '1' : '0',
    getScriptSnapshot: name => {
      const text = replacements.get(path.resolve(name)) ?? ts.sys.readFile(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: settings => ts.getDefaultLibFilePath(settings),
    fileExists: ts.sys.fileExists,
    readFile: name => replacements.get(path.resolve(name)) ?? ts.sys.readFile(name),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getProjectReferences: () => parsed.projectReferences,
  };
  const languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
  const compilerHost = ts.createCompilerHost(options);
  const originalRead = compilerHost.readFile.bind(compilerHost);
  compilerHost.readFile = name => replacements.get(path.resolve(name)) ?? originalRead(name);
  const program = ts.createProgram({ rootNames: scriptFiles, options, projectReferences: parsed.projectReferences, host: compilerHost });
  return { scriptFiles, languageService, program };
}
function cursorAt(source, line, column) {
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) throw new Error('cursor requires positive 1-based line and column');
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  if (line > starts.length) throw new Error('cursor line outside source');
  const begin = starts[line - 1];
  let end = line < starts.length ? starts[line] - 1 : source.length;
  if (source[end - 1] === '\r') end--;
  if (column > end - begin + 1) throw new Error('cursor column outside source');
  return begin + column - 1;
}
function identifier(name) {
  if (typeof name !== 'string' || !ts.isIdentifierText(name, ts.ScriptTarget.Latest)) return false;
  const token = ts.stringToToken(name);
  return token === undefined || token < ts.SyntaxKind.FirstKeyword || token > ts.SyntaxKind.LastKeyword;
}
/** Prepare a compiler-aware rename with no mutation; exact replacements are hashed. */
export function planCodeRename({ root = process.cwd(), config = 'tsconfig.json', file, line, column, newName, maxFiles = 128, maxEdits = 4096 } = {}) {
  const workspace = fs.realpathSync(path.resolve(root));
  if (!identifier(newName)) throw new Error('newName must be a non-keyword TypeScript identifier');
  const target = secureFile(workspace, file, 'target');
  const project = createProject(workspace, config);
  try {
    if (!project.scriptFiles.includes(target)) throw new Error('target is outside configured TypeScript project');
    const position = cursorAt(fs.readFileSync(target, 'utf8'), line, column);
    const info = project.languageService.getRenameInfo(target, position, { allowRenameOfImportPath: false });
    if (!info.canRename) throw new Error(`TypeScript cannot rename selected token: ${info.localizedErrorMessage ?? 'unknown'}`);
    if (info.displayName === newName) throw new Error('newName matches current symbol');
    const locations = project.languageService.findRenameLocations(target, position, false, false, true) ?? [];
    if (!locations.length) throw new Error('TypeScript returned no rename locations');
    const groups = new Map();
    for (const loc of locations) {
      const absolute = secureFile(workspace, loc.fileName, 'rename location');
      if (!project.scriptFiles.includes(absolute)) throw new Error('rename would modify a file outside the configured project');
      const edits = groups.get(absolute) ?? [];
      edits.push(loc);
      groups.set(absolute, edits);
    }
    if (groups.size > maxFiles || locations.length > maxEdits) throw new Error('rename exceeds configured change bounds');
    const replacementMap = new Map();
    const changed = [];
    for (const [absolute, edits] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const original = fs.readFileSync(absolute, 'utf8');
      const descending = edits.sort((a, b) => b.textSpan.start - a.textSpan.start);
      let output = original, lastStart = original.length + 1;
      const spans = [];
      for (const edit of descending) {
        const { start, length } = edit.textSpan;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || length < 1 || start + length > original.length || start + length > lastStart) throw new Error('invalid or overlapping compiler rename location');
        const before = original.slice(start, start + length);
        if (before !== info.displayName && before !== info.fullDisplayName && !identifier(before)) throw new Error('unexpected compiler rename span');
        const insert = (edit.prefixText ?? '') + newName + (edit.suffixText ?? '');
        output = output.slice(0, start) + insert + output.slice(start + length);
        lastStart = start;
        spans.push({ offset: start, before, after: insert });
      }
      replacementMap.set(absolute, output);
      changed.push({ path: slash(path.relative(workspace, absolute)), before_sha256: digest(original), after_sha256: digest(output), edits: spans.reverse() });
    }
    const updated = createProject(workspace, config, replacementMap);
    let added;
    try { added = additionalDiagnostics(diagnose(project.program, workspace), diagnose(updated.program, workspace)); }
    finally { updated.languageService.dispose(); }
    if (added.length) throw new Error(`rename introduces ${added.length} new compiler diagnostic types: ${JSON.stringify(added.slice(0, 5))}`);
    const planIdentity = digest(JSON.stringify({ root: workspace, symbol: info.displayName, name: newName, files: changed }));
    return { schema_version: '1.0.0', operation: 'typescript_safe_rename', mode: 'preview', workspace, config, symbol: info.displayName, new_name: newName, plan_sha256: planIdentity, file_count: changed.length, edit_count: locations.length, changed_files: changed, diagnostics_added: added.length };
  } finally { project.languageService.dispose(); }
}

/** Commit a plan only if every file still matches its observed SHA. Roll back on partial failures. */
export function applyCodeRename(plan, { beforeWrite } = {}) {
  if (!plan || plan.operation !== 'typescript_safe_rename' || plan.mode !== 'preview' || !Array.isArray(plan.changed_files))
    throw new Error('invalid rename plan');
  const root = fs.realpathSync(plan.workspace);
  const expectedIdentity = digest(JSON.stringify({
    root, symbol: plan.symbol, name: plan.new_name, files: plan.changed_files,
  }));
  if (expectedIdentity !== plan.plan_sha256) throw new Error('rename plan changed after preview');
  const prepared = [];
  for (const change of plan.changed_files) {
    const absolute = secureFile(root, change.path, 'changed file');
    const original = fs.readFileSync(absolute, 'utf8');
    if (digest(original) !== change.before_sha256) throw new Error(`source changed after preview: ${change.path}`);
    let content = original;
    for (const { offset, before, after } of [...change.edits].reverse()) {
      if (content.slice(offset, offset + before.length) !== before) throw new Error('source does not match planned edit');
      content = content.slice(0, offset) + after + content.slice(offset + before.length);
    }
    if (digest(content) !== change.after_sha256) throw new Error('planned content digest mismatch');
    prepared.push({ relative: change.path, original, content, expectedAfter: change.after_sha256 });
  }
  commitGuardedFiles({ root, files: prepared, beforeWrite });
  return { ...plan, mode: 'applied', readback_verified: true };
}

function parseArgs(args) {
  const options = { root: process.cwd(), config: 'tsconfig.json', apply: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--apply') { options.apply = true; continue; }
    if (!['--root', '--config', '--file', '--line', '--column', '--new-name'].includes(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${flag} requires a value`);
    const key = flag === '--new-name' ? 'newName' : flag.slice(2);
    options[key] = ['line', 'column'].includes(key) ? Number(args[++i]) : args[++i];
  }
  return options;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const plan = planCodeRename(args);
    const result = args.apply ? applyCodeRename(plan) : plan;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`code-refactor: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
