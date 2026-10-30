import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { completeCode } from './code-completion.mjs';
import { resolveCompletion } from './code-completion-resolve.mjs';

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'pro-code-completion-'));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' }, include: ['src/**/*.ts'] }));
  for (const [filename, source] of Object.entries(files)) writeFileSync(path.join(root, 'src', filename), source);
  return root;
}
const dispose = root => rmSync(root, { force: true, recursive: true });

test('compiler resolves typed member names from another source file', () => {
  const root = fixture({ 'types.ts': 'export interface Profile { displayName: string; displayAge: number }\n', 'main.ts': "import type { Profile } from './types';\ndeclare const p: Profile;\np.dis" });
  try {
    const result = completeCode({ root, file: 'src/main.ts', line: 3, column: 6, prefix: 'dis' });
    assert.equal(result.operation, 'typescript_language_service_completion');
    assert.deepEqual(result.entries.map(x => x.name).sort(), ['displayAge', 'displayName']);
    assert.equal(result.file, 'src/main.ts');
    assert.equal(result.cursor.offset, 71);
  } finally { dispose(root); }
});

test('results are bounded and do not mutate source files', () => {
  const source = 'const alphabet = 1; const beta = 2;\nal';
  const root = fixture({ 'main.ts': source });
  try {
    const result = completeCode({ root, file: 'src/main.ts', line: 2, column: 3, limit: 1 });
    assert.equal(result.entries.length, 1);
    assert.ok(result.total_matching >= 1);
    assert.equal(result.entries[0].name, 'alphabet');
    assert.equal(readFileSync(path.join(root, 'src/main.ts'), 'utf8'), source);
  } finally { dispose(root); }
});

test('refuses traversal and symlink targets outside workspace', () => {
  const root = fixture({ 'main.ts': 'const a = 1;\na' });
  const outside = mkdtempSync(path.join(tmpdir(), 'pro-code-outside-'));
  writeFileSync(path.join(outside, 'secret.ts'), 'const secret = true;');
  symlinkSync(path.join(outside, 'secret.ts'), path.join(root, 'src', 'linked.ts'));
  try {
    assert.throws(() => completeCode({ root, file: '../unrelated.ts', line: 1, column: 1 }), /inside workspace/);
    assert.throws(() => completeCode({ root, file: 'src/linked.ts', line: 1, column: 1 }), /outside workspace/);
    assert.throws(() => completeCode({ root, config: '../tsconfig.json', file: 'src/main.ts', line: 2, column: 2 }), /inside workspace/);
  } finally { dispose(root); dispose(outside); }
});

test('rejects out-of-range cursors, invalid limits, and files excluded by tsconfig', () => {
  const root = fixture({ 'main.ts': 'const a = 1;\na' });
  writeFileSync(path.join(root, 'ignored.ts'), 'const ignored = 1;');
  try {
    const base = { root, file: 'src/main.ts', line: 2, column: 2 };
    assert.throws(() => completeCode({ ...base, line: 100 }), /line is outside/);
    assert.throws(() => completeCode({ ...base, column: 100 }), /column is outside/);
    assert.throws(() => completeCode({ ...base, limit: 1000 }), /limit must/);
    assert.throws(() => completeCode({ ...base, line: 0 }), /positive 1-based/);
    assert.throws(() => completeCode({ ...base, file: 'ignored.ts' }), /not included/);
  } finally { dispose(root); }
});

test('CLI emits JSON and fails on missing required position', async () => {
  const root = fixture({ 'main.ts': 'const alpha = 1;\nal' });
  const cli = fileURLToPath(new URL('./code-completion.mjs', import.meta.url));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [cli, '--root', root, '--file', 'src/main.ts', '--line', '2', '--column', '3', '--prefix', 'al']);
    const report = JSON.parse(stdout);
    assert.ok(report.entries.some(x => x.name === 'alpha'));
    await assert.rejects(promisify(execFile)(process.execPath, [cli, '--root', root, '--file', 'src/main.ts']), /line and column/);
  } finally { dispose(root); }
});

test('transient editor buffer overrides disk without changing the source file', () => {
  const original = "interface Profile { oldField: string }\ndeclare const p: Profile;\np.old";
  const unsaved = "/** Description from the unsaved buffer. */\ninterface Profile { newField: string; newNumber: number }\ndeclare const p: Profile;\np.new";
  const root = fixture({ 'main.ts': original });
  try {
    const result = completeCode({ root, file: 'src/main.ts', line: 4, column: 6, content: unsaved, autoPrefix: true, includeDetails: true });
    assert.equal(result.source_kind, 'editor-buffer');
    assert.equal(result.is_dirty, true);
    assert.equal(result.prefix_used, 'new');
    assert.deepEqual(result.entries.map(entry => entry.name).sort(), ['newField', 'newNumber']);
    assert.ok(result.entries.every(entry => typeof entry.display_text === 'string' && Array.isArray(entry.code_actions)));
    assert.equal(readFileSync(path.join(root, 'src/main.ts'), 'utf8'), original);
    assert.deepEqual(completeCode({ root, file: 'src/main.ts', line: 3, column: 6, prefix: 'old' }).entries.map(entry => entry.name), ['oldField']);
  } finally { dispose(root); }
});

test('rejects oversized and malformed editor-buffer content', () => {
  const root = fixture({ 'main.ts': 'const a = 1;\na' });
  try {
    const args = { root, file: 'src/main.ts', line: 2, column: 2 };
    assert.throws(() => completeCode({ ...args, content: 42 }), /content must/);
    assert.throws(() => completeCode({ ...args, content: 'x'.repeat(2_097_153) }), /at most 2 MiB/);
    assert.throws(() => completeCode({ ...args, autoPrefix: 'yes' }), /must be booleans/);
  } finally { dispose(root); }
});

test('CLI accepts unsaved text from stdin and provides inferred prefix and detailed symbols', () => {
  const root = fixture({ 'main.ts': "interface Item { persisted: string }\ndeclare const item: Item;\nitem.per" });
  const cli = fileURLToPath(new URL('./code-completion.mjs', import.meta.url));
  const unsaved = "interface Item { current: string }\ndeclare const item: Item;\nitem.cur";
  try {
    const result = spawnSync(process.execPath, [
      cli, '--root', root, '--file', 'src/main.ts', '--line', '3', '--column', '9',
      '--content-stdin', '--auto-prefix', '--details',
    ], { input: unsaved, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.entries.map(entry => entry.name), ['current']);
    assert.equal(report.prefix_used, 'cur');
    assert.equal(report.source_kind, 'editor-buffer');
    assert.ok(report.entries[0].display_text.includes('current'));
  } finally { dispose(root); }
});

test('resolves compiler documentation and complete auto-import edits without writing files', () => {
  const source = 'addVal';
  const root = fixture({
    'helpers.ts': '/** Adds two values together. */\nexport function addValues(a: number, b: number) { return a + b; }\n',
    'main.ts': source,
  });
  try {
    const result = completeCode({ root, file: 'src/main.ts', line: 1, column: 7, resolveName: 'addValues' });
    assert.equal(result.schema_version, '1.1.0');
    assert.equal(result.resolution.name, 'addValues');
    assert.match(result.resolution.display, /addValues/);
    assert.match(result.resolution.documentation, /Adds two values together/);
    const action = result.resolution.code_actions.find(x => /import/i.test(x.description));
    assert.ok(action, 'TypeScript must provide an import code action');
    assert.equal(action.within_workspace, true);
    assert.equal(action.requires_commands, false);
    assert.equal(action.changes[0].file, 'src/main.ts');
    assert.match(action.changes[0].text_changes[0].new_text, /import.*addValues.*helpers/);
    assert.equal(readFileSync(path.join(root, 'src/main.ts'), 'utf8'), source);
  } finally { dispose(root); }
});

test('does not expose or claim a code action that escapes workspace through a symlink', () => {
  const root = fixture({ 'main.ts': 'a' });
  const outside = mkdtempSync(path.join(tmpdir(), 'pro-code-completion-edits-'));
  writeFileSync(path.join(outside, 'outside.ts'), 'const secret = 1;');
  symlinkSync(path.join(outside, 'outside.ts'), path.join(root, 'src', 'escaped.ts'));
  try {
    const service = { getCompletionEntryDetails: () => ({
      kind: 'var', displayParts: [{ text: 'a', kind: 'text' }],
      codeActions: [{ description: 'unsafe cross-workspace edit', changes: [
        { fileName: path.join(root, 'src', 'escaped.ts'), textChanges: [{ span: { start: 0, length: 0 }, newText: 'LEAK' }] },
      ] }],
    }) };
    const resolved = resolveCompletion({
      service, workspace: root, file: path.join(root, 'src', 'main.ts'),
      position: 1, entries: [{ name: 'a' }], name: 'a',
    });
    assert.equal(resolved.code_actions[0].within_workspace, false);
    assert.deepEqual(resolved.code_actions[0].changes, []);
    assert.equal(readFileSync(path.join(outside, 'outside.ts'), 'utf8'), 'const secret = 1;');
  } finally { dispose(root); dispose(outside); }
});

test('rejects absent and ambiguous completion resolution, and malformed source selection', () => {
  const root = fixture({ 'main.ts': 'alpha' });
  try {
    assert.throws(() => completeCode({ root, file: 'src/main.ts', line: 1, column: 6, resolveName: 'notActuallyHere' }), /not available/);
    assert.throws(() => completeCode({ root, file: 'src/main.ts', line: 1, column: 6, resolveSource: 'wrong' }), /requires resolve-name/);
    const service = { getCompletionEntryDetails: () => ({}) };
    const base = { service, workspace: root, file: path.join(root, 'src', 'main.ts'), position: 5,
      entries: [{ name: 'alpha', source: './one' }, { name: 'alpha', source: './two' }], name: 'alpha' };
    assert.throws(() => resolveCompletion(base), /ambiguous/);
    assert.equal(resolveCompletion({ ...base, source: './one' }).source, './one');
  } finally { dispose(root); }
});

test('CLI resolves a selected suggestion and rejects nonexistent resolution names', async () => {
  const root = fixture({ 'main.ts': 'const alpha = 1;\nal' });
  const cli = fileURLToPath(new URL('./code-completion.mjs', import.meta.url));
  try {
    const args = [cli, '--root', root, '--file', 'src/main.ts', '--line', '2', '--column', '3'];
    const { stdout } = await promisify(execFile)(process.execPath, [...args, '--resolve-name', 'alpha']);
    assert.equal(JSON.parse(stdout).resolution.name, 'alpha');
    await assert.rejects(promisify(execFile)(process.execPath, [...args, '--resolve-name', 'missingName']), /not available/);
  } finally { dispose(root); }
});
