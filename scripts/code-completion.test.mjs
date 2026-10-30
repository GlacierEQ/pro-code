import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { completeCode } from './code-completion.mjs';

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

test('compiler-backed completion details include a real auto-import edit proposal', () => {
  const root = fixture({
    'library.ts': 'export function rocketLaunch(): void {}\n',
    'main.ts': 'rock',
  });
  try {
    const initial = readFileSync(path.join(root, 'src/main.ts'), 'utf8');
    const result = completeCode({
      root, file: 'src/main.ts', line: 1, column: 5,
      prefix: 'rocket', includeDetails: true,
    });
    const suggestion = result.entries.find(entry => entry.name === 'rocketLaunch');
    assert.ok(suggestion, 'compiler should offer the module export');
    assert.equal(suggestion.requires_code_action, true);
    assert.ok(suggestion.details?.code_actions?.length, 'auto-import must have a concrete code action');
    const edits = suggestion.details.code_actions.flatMap(action => action.changes);
    assert.ok(edits.some(edit => edit.file === 'src/main.ts'
      && edit.text_changes.some(change => change.new_text.includes('import'))));
    assert.equal(readFileSync(path.join(root, 'src/main.ts'), 'utf8'), initial, 'completion must remain read-only');
    assert.ok(!Object.hasOwn(completeCode({
      root, file: 'src/main.ts', line: 1, column: 5, prefix: 'rocket',
    }).entries[0], 'details'), 'expensive details are strictly opt-in');
  } finally { dispose(root); }
});

test('optional compiler diagnostics report semantic errors with source locations', () => {
  const root = fixture({
    'main.ts': 'const answer: number = "wrong";\nans',
  });
  try {
    const report = completeCode({
      root, file: 'src/main.ts', line: 2, column: 4,
      prefix: 'ans', includeDiagnostics: true,
    });
    const error = report.diagnostics.find(item => item.code === 2322);
    assert.ok(error, 'TypeScript must detect incompatible assignment');
    assert.equal(error.category, 'error');
    assert.equal(error.line, 1);
    assert.ok(error.column >= 1);
    const plain = completeCode({ root, file: 'src/main.ts', line: 2, column: 4 });
    assert.equal(Object.hasOwn(plain, 'diagnostics'), false);
    assert.throws(() => completeCode({
      root, file: 'src/main.ts', line: 2, column: 4, includeDetails: 'true',
    }), /must be booleans/);
  } finally { dispose(root); }
});

test('CLI exposes details and diagnostics without requiring an editor or writing files', async () => {
  const root = fixture({
    'library.ts': 'export const stellarObject = 42;\n',
    'main.ts': 'stel',
  });
  const cli = fileURLToPath(new URL('./code-completion.mjs', import.meta.url));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [
      cli, '--root', root, '--file', 'src/main.ts', '--line', '1',
      '--column', '5', '--prefix', 'stellar', '--details', '--diagnostics',
    ]);
    const report = JSON.parse(stdout);
    assert.ok(Array.isArray(report.diagnostics));
    assert.ok(report.entries.some(item => item.name === 'stellarObject'
      && item.details.code_actions.length > 0));
    await assert.rejects(promisify(execFile)(process.execPath, [cli, '--wat']), /Unknown argument/);
  } finally { dispose(root); }
});
