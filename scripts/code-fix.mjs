import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createProject, diagnose, additionalDiagnostics } from './code-refactor.mjs';
import { commitGuardedFiles } from './refactor-transaction.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const unix = value => value.split(path.sep).join('/');
function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
function secureFile(root, requested) {
  if (typeof requested !== 'string' || !requested) throw new Error('file is required');
  const absolute = path.resolve(root, requested);
  if (!inside(root, absolute)) throw new Error('code fix file escapes workspace');
  const actual = fs.realpathSync(absolute);
  if (!inside(root, actual) || actual !== absolute || !fs.statSync(actual).isFile()) {
    throw new Error('code fix target must be a regular, non-symlink workspace file');
  }
  return actual;
}
function diagnosticDetails(service, file) {
  return [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)]
    .filter(d => Number.isSafeInteger(d.start) && Number.isSafeInteger(d.length))
    .sort((a, b) => a.start - b.start || a.code - b.code);
}
const format = { indentSize: 2, tabSize: 2, newLineCharacter: '\n' };
const preferences = { includeCompletionsForModuleExports: true };
function actionsFor(service, file, diagnostic) {
  return service.getCodeFixesAtPosition(
    file, diagnostic.start, diagnostic.start + diagnostic.length,
    [diagnostic.code], format, preferences,
  );
}
function diagnosticRecord(source, d) {
  const prefix = source.slice(0, d.start);
  const lines = prefix.split('\n');
  const location = { line: lines.length - 1, character: lines[lines.length - 1].length };
  return {
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    line: location.line + 1,
    column: location.character + 1,
    start: d.start,
    length: d.length,
  };
}

/** Discover current compiler diagnostics and genuinely available fixes without modifying files. */
export function inspectCodeFixes({ root = process.cwd(), config = 'tsconfig.json', file, limit = 50 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be 1..100');
  const workspace = fs.realpathSync(path.resolve(root));
  const target = secureFile(workspace, file);
  const project = createProject(workspace, config);
  try {
    if (!project.scriptFiles.includes(target)) throw new Error('target is outside configured TypeScript project');
    const source = fs.readFileSync(target, 'utf8');
    const diagnostics = diagnosticDetails(project.languageService, target);
    return {
      schema_version: '1.0.0', operation: 'typescript_code_fix_inventory',
      file: unix(path.relative(workspace, target)), compiler_version: ts.version,
      diagnostic_count: diagnostics.length, returned: Math.min(diagnostics.length, limit),
      diagnostics: diagnostics.slice(0, limit).map((d, index) => ({
        ...diagnosticRecord(source, d),
        occurrence: diagnostics.slice(0, index).filter(other => other.code === d.code).length,
        actions: actionsFor(project.languageService, target, d).map((action, fixIndex) => ({
          fix_index: fixIndex, description: action.description,
          requires_commands: Boolean(action.commands?.length),
          file_count: action.changes.length,
        })),
      })),
      source_modified: false,
    };
  } finally { project.languageService.dispose(); }
}

/** Compiler-selected fix plan, with validated full-file digests and zero added TS diagnostics. */
export function planCodeFix({
  root = process.cwd(), config = 'tsconfig.json', file, code,
  occurrence = 0, fixIndex = 0, maxFiles = 32, maxEdits = 512,
} = {}) {
  if (![code, occurrence, fixIndex, maxFiles, maxEdits].every(Number.isSafeInteger)
    || code <= 0 || occurrence < 0 || fixIndex < 0 || maxFiles < 1 || maxEdits < 1) {
    throw new Error('code must be a positive TypeScript diagnostic; indices and bounds must be valid integers');
  }
  const workspace = fs.realpathSync(path.resolve(root));
  const target = secureFile(workspace, file);
  const project = createProject(workspace, config);
  try {
    if (!project.scriptFiles.includes(target)) throw new Error('target is outside configured TypeScript project');
    const diagnostics = diagnosticDetails(project.languageService, target);
    const matching = diagnostics.filter(d => d.code === code);
    if (occurrence >= matching.length) throw new Error('requested TypeScript diagnostic occurrence not found');
    const selected = matching[occurrence];
    const actions = actionsFor(project.languageService, target, selected);
    if (fixIndex >= actions.length) throw new Error('requested compiler code fix index not found');
    const action = actions[fixIndex];
    if (action.commands?.length) throw new Error('compiler fix requires commands that cannot safely be applied');
    if (!action.changes?.length) throw new Error('compiler fix contains no file edits');
    if (action.changes.length > maxFiles) throw new Error('compiler fix exceeds file bound');
    const replacements = new Map(), changed = [];
    let totalEdits = 0;
    const grouped = new Map();
    for (const change of action.changes) {
      if (change.isNewFile) throw new Error('compiler fix creating files is not supported by guarded transaction');
      const absolute = secureFile(workspace, change.fileName);
      if (!project.scriptFiles.includes(absolute)) throw new Error('compiler fix modifies a file outside configured project');
      const existing = grouped.get(absolute) ?? [];
      existing.push(...change.textChanges);
      grouped.set(absolute, existing);
    }
    if (grouped.size > maxFiles) throw new Error('compiler fix exceeds file bound');
    for (const [absolute, textChanges] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
      totalEdits += textChanges.length;
      if (totalEdits > maxEdits) throw new Error('compiler fix exceeds edit bound');
      const original = fs.readFileSync(absolute, 'utf8');
      const edits = textChanges.map(edit => ({
        start: edit.span.start, length: edit.span.length, after: edit.newText,
      })).sort((a, b) => b.start - a.start || b.length - a.length);
      let output = original, priorStart = original.length + 1;
      for (const edit of edits) {
        if (!Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.length)
          || edit.start < 0 || edit.length < 0 || edit.start + edit.length > original.length
          || edit.start + edit.length > priorStart
          || (edit.length === 0 && edit.start === priorStart)
          || typeof edit.after !== 'string') {
          throw new Error('compiler fix contains overlapping or invalid text edits');
        }
        edit.before = original.slice(edit.start, edit.start + edit.length);
        output = output.slice(0, edit.start) + edit.after + output.slice(edit.start + edit.length);
        priorStart = edit.start;
      }
      if (output === original) throw new Error('compiler fix would not change source');
      replacements.set(absolute, output);
      changed.push({
        path: unix(path.relative(workspace, absolute)),
        before_sha256: digest(original), after_sha256: digest(output),
        edits: edits.reverse(),
      });
    }
    if (!changed.length) throw new Error('compiler fix returned no effective changes');
    const updated = createProject(workspace, config, replacements);
    try {
      const added = additionalDiagnostics(diagnose(project.program, workspace), diagnose(updated.program, workspace));
      if (added.length) throw new Error('compiler fix introduces new diagnostics: ' + JSON.stringify(added.slice(0, 5)));
      const remaining = diagnosticDetails(updated.languageService, target).filter(d => d.code === code);
      if (remaining.length >= matching.length) {
        throw new Error('compiler fix did not reduce selected TypeScript diagnostic count');
      }
    } finally { updated.languageService.dispose(); }
    const selectedDiagnostic = diagnosticRecord(fs.readFileSync(target, 'utf8'), selected);
    const core = {
      workspace, config, file: unix(path.relative(workspace, target)),
      diagnostic: selectedDiagnostic, occurrence, fix_index: fixIndex,
      description: action.description, changed_files: changed,
    };
    return {
      schema_version: '1.0.0', operation: 'typescript_compiler_code_fix', mode: 'preview',
      ...core, plan_sha256: digest(JSON.stringify(core)),
      file_count: changed.length, edit_count: totalEdits,
      diagnostics_added: 0, selected_diagnostic_reduced: true,
      source_modified: false,
    };
  } finally { project.languageService.dispose(); }
}

/** Apply an unchanged compiler plan through existing guarded, rollback-capable native writes. */
export function applyCodeFix(plan, { beforeWrite } = {}) {
  if (!plan || plan.operation !== 'typescript_compiler_code_fix' || plan.mode !== 'preview'
    || !Array.isArray(plan.changed_files) || plan.changed_files.length === 0) throw new Error('invalid code fix plan');
  const { workspace, config, file, diagnostic, occurrence, fix_index, description, changed_files } = plan;
  const core = { workspace, config, file, diagnostic, occurrence, fix_index, description, changed_files };
  if (digest(JSON.stringify(core)) !== plan.plan_sha256) throw new Error('code fix plan changed after preview');
  const root = fs.realpathSync(workspace);
  if (root !== workspace) throw new Error('workspace changed after preview');
  const files = changed_files.map(change => {
    const absolute = secureFile(root, change.path);
    const original = fs.readFileSync(absolute, 'utf8');
    if (digest(original) !== change.before_sha256) throw new Error('source changed after preview: ' + change.path);
    let content = original;
    let previousEnd = 0;
    for (const edit of change.edits) {
      if (!Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.length)
        || edit.start < previousEnd || edit.length < 0
        || content.length < edit.start + edit.length
        || original.slice(edit.start, edit.start + edit.length) !== edit.before) {
        throw new Error('code fix plan has invalid edit spans');
      }
      previousEnd = edit.start + edit.length;
    }
    for (const edit of [...change.edits].reverse()) {
      content = content.slice(0, edit.start) + edit.after + content.slice(edit.start + edit.length);
    }
    if (digest(content) !== change.after_sha256) throw new Error('code fix planned digest mismatch');
    return { relative: change.path, original, content, expectedAfter: change.after_sha256 };
  });
  const receipt = commitGuardedFiles({ root, files, beforeWrite });
  if (!receipt.verified || receipt.changed !== files.length) throw new Error('code fix write readback failed');
  return { ...plan, mode: 'applied', readback_verified: true, source_modified: true };
}

function argsFromCli(args) {
  const options = { root: process.cwd(), config: 'tsconfig.json', occurrence: 0, fixIndex: 0, apply: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--apply') { options.apply = true; continue; }
    if (!['--root', '--config', '--file', '--code', '--occurrence', '--fix-index', '--limit'].includes(flag)) {
      throw new Error('Unknown argument: ' + flag);
    }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(flag + ' requires a value');
    const key = flag === '--fix-index' ? 'fixIndex' : flag.slice(2);
    options[key] = ['code', 'occurrence', 'fixIndex', 'limit'].includes(key) ? Number(args[++i]) : args[++i];
  }
  return options;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const args = argsFromCli(process.argv.slice(2));
    if (args.apply && args.code === undefined) throw new Error('--apply requires --code');
    const report = args.code === undefined ? inspectCodeFixes(args) : planCodeFix(args);
    const result = args.apply ? applyCodeFix(report) : report;
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write('code-fix: ' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}
