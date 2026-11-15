import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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


/**
 * A compiler-selected repair followed by an independent Node test file.
 * Its only mutation authority is the existing guarded code-fix transaction.
 * Failed verification attempts restore exact original bytes, but do not
 * overwrite a file another writer has modified since our applied digest.
 */
export function executeVerifiedCodeRepair({
  root = process.cwd(), config = 'tsconfig.json', file, code, occurrence = 0,
  fixIndex = null, verifyTest, timeoutMs = 30_000, beforeWrite,
} = {}) {
  if (!Number.isSafeInteger(code) || code <= 0 || !Number.isSafeInteger(occurrence) || occurrence < 0
    || (fixIndex !== null && (!Number.isSafeInteger(fixIndex) || fixIndex < 0))
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000
    || typeof verifyTest !== 'string' || !verifyTest.trim()) {
    throw new TypeError('repair requires a positive diagnostic, valid fix index, 1000..120000 ms timeout, and a verifyTest path');
  }
  const workspace = fs.realpathSync(path.resolve(root));
  const verifier = secureFile(workspace, verifyTest);
  if (!/\.(?:mjs|cjs|js)$/.test(verifier)) throw new Error('verification must be a workspace Node test file');
  // Pin verifier bytes from the validated inode. The original pathname is
  // untrusted after this point; each run uses the same private copy placed
  // beside it so relative imports retain their workspace directory.
  const beforeVerifier = fs.statSync(verifier);
  const verifierFd = fs.openSync(verifier, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let verifierBytes;
  try {
    const opened = fs.fstatSync(verifierFd);
    if (!opened.isFile() || beforeVerifier.dev !== opened.dev || beforeVerifier.ino !== opened.ino) {
      throw new Error('verification file changed between validation and read');
    }
    verifierBytes = fs.readFileSync(verifierFd);
  } finally { fs.closeSync(verifierFd); }
  // Use complete compiler diagnostics rather than a truncated inventory UI.
  const target = secureFile(workspace, file);
  const initialProject = createProject(workspace, config);
  let originalDiagnosticCount;
  let originalProjectDiagnostics;
  let projectFileHashes;
  let candidateActions;
  try {
    if (!initialProject.scriptFiles.includes(target)) throw new Error('target outside configured TypeScript project');
    const matching = diagnosticDetails(initialProject.languageService, target).filter(d => d.code === code);
    if (occurrence >= matching.length) throw new Error('selected compiler diagnostic not found in original source');
    originalDiagnosticCount = matching.length;
    originalProjectDiagnostics = diagnose(initialProject.program, workspace);
    projectFileHashes = new Map(initialProject.scriptFiles.map(name => [
      name, digest(fs.readFileSync(name)),
    ]));
    candidateActions = actionsFor(initialProject.languageService, target, matching[occurrence])
      .map((action, index) => ({ fix_index: index,
        requires_commands: Boolean(action.commands?.length), file_count: action.changes?.length ?? 0 }));
  } finally { initialProject.languageService.dispose(); }
  const eligible = candidateActions.filter(action => !action.requires_commands && action.file_count > 0);
  const indices = fixIndex === null ? eligible.map(action => action.fix_index) : [fixIndex];
  let plan;
  const rejected = [];
  for (const index of indices) {
    try {
      plan = planCodeFix({ root: workspace, config, file, code, occurrence, fixIndex: index });
      break;
    } catch (error) {
      rejected.push({ fix_index: index, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!plan) throw new Error('no compiler-verified code fix available: ' + JSON.stringify(rejected));
  if (plan.changed_files.some(change => path.resolve(workspace, change.path) === verifier)) {
    throw new Error('verification file cannot be modified by its own repair');
  }
  const originals = plan.changed_files.map(change => {
    const absolute = secureFile(workspace, change.path);
    const raw = fs.readFileSync(absolute);
    const original = raw.toString('utf8');
    if (!Buffer.from(original, 'utf8').equals(raw)) {
      throw new Error('refusing non-lossless UTF-8 source: ' + change.path);
    }
    if (digest(raw) !== change.before_sha256) throw new Error('source changed after preview: ' + change.path);
    return { relative: change.path, original, before: change.before_sha256, after: change.after_sha256 };
  });

  const executeTest = () => {
    // Node test runners set NODE_TEST_CONTEXT=child-v8 on their children;
    // retaining it makes nested "node --test" skip all tests and exit zero.
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const stagedPath = path.join(path.dirname(verifier),
      '.pro-code-verifier-' + crypto.randomUUID() + path.extname(verifier));
    fs.writeFileSync(stagedPath, verifierBytes, { flag: 'wx', mode: 0o600 });
    try {
      const result = spawnSync(process.execPath, ['--test', stagedPath], {
        cwd: workspace, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 1_048_576,
        shell: false, env: childEnv,
      });
      const stdout = result.stdout ?? '';
      const declaredTests = /^# tests (\d+)$/m.exec(stdout);
      const declaredPasses = /^# pass (\d+)$/m.exec(stdout);
      const hasSubtest = /^# Subtest: .+$/m.test(stdout);
      // An empty .test.mjs file can return success as a single wrapper test;
      // require a registered, non-skipped assertion-bearing Node subtest.
      const testsExecuted = hasSubtest && declaredTests !== null && declaredPasses !== null
        && Number(declaredTests[1]) > 0 && Number(declaredPasses[1]) > 0;
      const verifierUnchanged = fs.existsSync(stagedPath)
        && digest(fs.readFileSync(stagedPath)) === digest(verifierBytes);
      return {
        passed: result.status === 0 && !result.signal && !result.error && testsExecuted && verifierUnchanged,
        tests_executed: declaredTests ? Number(declaredTests[1]) : 0,
        tests_passed: declaredPasses ? Number(declaredPasses[1]) : 0,
        verifier_sha256: digest(verifierBytes), verifier_unchanged: verifierUnchanged,
        exit_code: result.status, signal: result.signal ?? null,
        error_code: result.error?.code ?? null,
        stdout_tail: stdout.slice(-2048), stderr_tail: (result.stderr ?? '').slice(-2048),
      };
    } finally {
      try { fs.unlinkSync(stagedPath); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  };
  // Detect verifier and unrelated concurrent mutations across the entire
  // indexed TypeScript project, not just the file selected for repair.
  const unexpectedProjectFiles = () => [...projectFileHashes].filter(([name, originalHash]) => {
    try {
      const current = secureFile(workspace, path.relative(workspace, name));
      return digest(fs.readFileSync(current)) !== originalHash;
    } catch { return true; }
  }).map(([name]) => path.relative(workspace, name).split(path.sep).join('/'));
  const baseline = executeTest();
  const receipt = {
    schema_version: 'glaciereq.pro-code.verified-code-repair.v1',
    operation: 'verified_typescript_code_repair',
    target: plan.file, diagnostic: code,
    selected_action: plan.description, selected_fix_index: plan.fix_index,
    plan_sha256: plan.plan_sha256,
    source_before: originals.map(x => ({ path: x.relative, sha256: x.before })),
    source_expected_after: originals.map(x => ({ path: x.relative, sha256: x.after })),
    verifier: path.relative(workspace, verifier).split(path.sep).join('/'),
    baseline,
    verification: null,
    unplanned_project_files: [],
    outcome: 'blocked',
    source_modified: false,
    rollback: null,
    limitations: [
      'Node test verification is limited to the provided test file and compiler diagnostic; it does not prove production deployment.',
      'A process crash between multi-file writes cannot guarantee atomic rollback.',
      'A verification script that independently changes a repaired source file prevents automatic restoration to avoid clobbering that writer.',
    ],
  };
  // An independent test is code execution, not a trusted read-only oracle.
  // If the baseline test changed a source file, stop before applying our edit.
  const baselineChanges = unexpectedProjectFiles();
  const baselineHashesMatch = originals.every(item => {
    try { return digest(fs.readFileSync(secureFile(workspace, item.relative))) === item.before; }
    catch { return false; }
  });
  if (!baselineHashesMatch || baselineChanges.length) {
    receipt.outcome = 'baseline_verifier_modified_source';
    receipt.source_modified = true;
    receipt.unplanned_project_files = baselineChanges;
    return receipt;
  }
  if (baseline.error_code === 'ETIMEDOUT' || baseline.error_code === 'ENOBUFS') {
    receipt.outcome = 'baseline_verifier_unavailable';
    return receipt;
  }
  try {
    applyCodeFix(plan, { beforeWrite });
  } catch (error) {
    // commitGuardedFiles already makes a best-effort rollback on any caught
    // failure. Independently read the current bytes before making a claim.
    receipt.application_error = error instanceof Error ? error.message : String(error);
    try {
      const current = originals.map(item => ({
        ...item, content: fs.readFileSync(secureFile(workspace, item.relative), 'utf8'),
      }));
      const states = current.map(item => digest(item.content));
      if (states.every((state, index) => state === originals[index].before)) {
        receipt.outcome = 'application_failed_unchanged';
        receipt.rollback = { attempted: false, verified: true, error: null };
        receipt.source_modified = false;
        return receipt;
      }
      if (states.some((state, index) => state !== originals[index].before && state !== originals[index].after)) {
        throw new Error('unrecognized source mutation after failed apply; preserved');
      }
      const changed = current.filter((item, index) => states[index] === item.after);
      const restored = commitGuardedFiles({
        root: workspace,
        files: changed.map(item => ({
          relative: item.relative, original: item.content,
          content: item.original, expectedAfter: item.before,
        })),
      });
      const exact = restored.verified && originals.every(item =>
        digest(fs.readFileSync(secureFile(workspace, item.relative), 'utf8')) === item.before);
      receipt.rollback = { attempted: true, verified: exact, error: null };
      receipt.source_modified = !exact;
      receipt.outcome = exact ? 'application_failed_restored' : 'restoration_not_verified';
    } catch (restoreError) {
      receipt.outcome = 'blocked_partial_or_external_write';
      receipt.source_modified = true;
      receipt.rollback = { attempted: true, verified: false,
        error: restoreError instanceof Error ? restoreError.message : String(restoreError) };
    }
    return receipt;
  }
  let postError = null;
  try {
    const test = executeTest();
    const currentProject = createProject(workspace, config);
    let remaining;
    let introduced;
    try {
      remaining = diagnosticDetails(currentProject.languageService, target).filter(d => d.code === code).length;
      introduced = additionalDiagnostics(originalProjectDiagnostics, diagnose(currentProject.program, workspace));
    } finally { currentProject.languageService.dispose(); }
    const hashesMatch = originals.every(item =>
      digest(fs.readFileSync(secureFile(workspace, item.relative))) === item.after);
    const expectedTargets = new Set(originals.map(item => path.resolve(workspace, item.relative)));
    const externalChanges = unexpectedProjectFiles()
      .filter(name => !expectedTargets.has(path.resolve(workspace, name)));
    receipt.unplanned_project_files = externalChanges;
    receipt.verification = {
      ...test, compiler_diagnostic_before: originalDiagnosticCount,
      compiler_diagnostic_after: remaining, new_project_diagnostic_count: introduced.length,
      new_project_diagnostics: introduced.slice(0, 10), all_write_hashes_match: hashesMatch,
    };
    if (test.passed && remaining < originalDiagnosticCount && hashesMatch && !introduced.length && !externalChanges.length) {
      receipt.outcome = 'verified_code_repair';
      receipt.source_modified = true;
      return receipt;
    }
  } catch (error) {
    postError = error instanceof Error ? error.message : String(error);
    receipt.verification = { passed: false, error: postError };
  }

  // Verification failed. Restore only if every intended file still carries
  // our own after-digest; the existing transaction performs all-file preflight.
  try {
    const restores = originals.map(item => ({
      relative: item.relative, original: fs.readFileSync(secureFile(workspace, item.relative), 'utf8'),
      content: item.original, expectedAfter: item.before,
    }));
    for (let i = 0; i < restores.length; i++) {
      if (digest(restores[i].original) !== originals[i].after) {
        throw new Error('independent write after repair: ' + restores[i].relative);
      }
    }
    const restored = commitGuardedFiles({ root: workspace, files: restores });
    const exact = restored.verified && originals.every(item =>
      digest(fs.readFileSync(secureFile(workspace, item.relative), 'utf8')) === item.before);
    receipt.rollback = { attempted: true, verified: exact, error: null };
    receipt.source_modified = !exact || receipt.unplanned_project_files.length > 0;
    receipt.outcome = !exact ? 'restoration_not_verified'
      : receipt.unplanned_project_files.length ? 'verification_failed_restored_with_external_changes'
        : 'verification_failed_restored';
  } catch (error) {
    receipt.rollback = { attempted: true, verified: false,
      error: error instanceof Error ? error.message : String(error) };
    receipt.source_modified = true; // uncertain/changed, never claim pristine
    receipt.outcome = 'blocked_external_write_or_rollback_failure';
  }
  return receipt;
}

function argsFromCli(args) {
  const options = { root: process.cwd(), config: 'tsconfig.json', occurrence: 0, fixIndex: undefined, apply: false, repair: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--apply') { options.apply = true; continue; }
    if (flag === '--repair') { options.repair = true; continue; }
    if (!['--root', '--config', '--file', '--code', '--occurrence', '--fix-index', '--limit', '--verify-test', '--timeout-ms'].includes(flag)) {
      throw new Error('Unknown argument: ' + flag);
    }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(flag + ' requires a value');
    const key = flag === '--fix-index' ? 'fixIndex' : flag === '--verify-test' ? 'verifyTest'
      : flag === '--timeout-ms' ? 'timeoutMs' : flag.slice(2);
    options[key] = ['code', 'occurrence', 'fixIndex', 'limit', 'timeoutMs'].includes(key) ? Number(args[++i]) : args[++i];
  }
  return options;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const args = argsFromCli(process.argv.slice(2));
    if (args.repair && args.apply) throw new Error('--repair and --apply are separate modes');
    if (args.repair && (args.code === undefined || !args.verifyTest)) {
      throw new Error('--repair requires --code and --verify-test');
    }
    if (!args.repair && args.verifyTest) throw new Error('--verify-test requires --repair');
    if (args.apply && args.code === undefined) throw new Error('--apply requires --code');
    const result = args.repair ? executeVerifiedCodeRepair({
      ...args, fixIndex: args.fixIndex ?? null,
    }) : args.apply ? applyCodeFix(planCodeFix(args))
      : args.code === undefined ? inspectCodeFixes(args) : planCodeFix(args);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (args.repair && result.outcome !== 'verified_code_repair') process.exitCode = 1;
  } catch (error) {
    process.stderr.write('code-fix: ' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}
