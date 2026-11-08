import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { inspectCodeFixes, planCodeFix, applyCodeFix } from './code-fix.mjs';

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-code-fix-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noEmit: true },
    include: ['src/**/*.ts'],
  }));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(root, 'src', name), body);
  return root;
}
const clean = root => fs.rmSync(root, { recursive: true, force: true });
const read = (root, file) => fs.readFileSync(path.join(root, 'src', file), 'utf8');
function firstFix(root, code = 2304) {
  const items = inspectCodeFixes({ root, file: 'src/main.ts' }).diagnostics.filter(d => d.code === code);
  assert.ok(items.length, 'fixture should produce TypeScript diagnostic ' + code);
  const candidate = items[0].actions.find(x => !x.requires_commands && x.file_count);
  assert.ok(candidate, 'compiler should offer a safe real code action');
  return planCodeFix({ root, file: 'src/main.ts', code, fixIndex: candidate.fix_index });
}

test('inventory lists real TS errors and compiler-generated fixes without writing', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'const n = rocketLaunch();\n' });
  try {
    const result = inspectCodeFixes({ root, file: 'src/main.ts' });
    assert.equal(result.operation, 'typescript_code_fix_inventory');
    assert.ok(result.diagnostics.some(d => d.code === 2304));
    assert.ok(result.diagnostics.find(d => d.code === 2304).actions.length);
    assert.equal(result.source_modified, false);
    assert.equal(read(root, 'main.ts'), 'const n = rocketLaunch();\n');
  } finally { clean(root); }
});

test('preview compiler auto-import then atomically apply real cross-file-aware correction', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'const n = rocketLaunch();\n' });
  try {
    const plan = firstFix(root);
    assert.equal(plan.mode, 'preview');
    assert.equal(plan.diagnostics_added, 0);
    assert.ok(plan.changed_files.some(f => f.path === 'src/main.ts'));
    assert.equal(read(root, 'main.ts'), 'const n = rocketLaunch();\n');
    const result = applyCodeFix(plan);
    assert.equal(result.mode, 'applied');
    assert.equal(result.readback_verified, true);
    assert.match(read(root, 'main.ts'), /import.*rocketLaunch.*from/);
    assert.equal(inspectCodeFixes({ root, file: 'src/main.ts' }).diagnostics.filter(d => d.code === 2304).length, 0);
  } finally { clean(root); }
});

test('stale preview fails closed and preserves independently modified source', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'rocketLaunch();\n' });
  try {
    const plan = firstFix(root);
    fs.writeFileSync(path.join(root, 'src/main.ts'), '// editing concurrently\nrocketLaunch();\n');
    assert.throws(() => applyCodeFix(plan), /source changed after preview/);
    assert.equal(read(root, 'main.ts'), '// editing concurrently\nrocketLaunch();\n');
  } finally { clean(root); }
});

test('tampered plan fails closed, and applied plan cannot be replayed', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'rocketLaunch();\n' });
  try {
    const plan = firstFix(root);
    assert.throws(() => applyCodeFix({ ...plan, description: 'different action' }), /plan changed/);
    assert.equal(read(root, 'main.ts'), 'rocketLaunch();\n');
    applyCodeFix(plan);
    assert.throws(() => applyCodeFix(plan), /source changed after preview/);
  } finally { clean(root); }
});

test('rejects invalid selection, outside workspace and symlinked project files', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'rocketLaunch();\n' });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-code-fix-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'secret.ts'), 'const secret = 1;');
    fs.symlinkSync(path.join(outside, 'secret.ts'), path.join(root, 'src', 'linked.ts'));
    assert.throws(() => planCodeFix({ root, file: '../secret.ts', code: 2304 }), /escapes workspace/);
    assert.throws(() => planCodeFix({ root, file: 'src/linked.ts', code: 2304 }), /non-symlink workspace file/);
    assert.throws(() => planCodeFix({ root, file: 'src/main.ts', code: 2304, occurrence: 55 }), /occurrence not found/);
    assert.throws(() => planCodeFix({ root, file: 'src/main.ts', code: 2304, fixIndex: 999 }), /index not found/);
    assert.throws(() => planCodeFix({ root, file: 'src/main.ts', code: -1 }), /positive TypeScript diagnostic/);
  } finally { clean(root); clean(outside); }
});

test('does not overwrite source on blocked transaction lock', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'rocketLaunch();\n' });
  try {
    const plan = firstFix(root);
    fs.mkdirSync(path.join(root, '.pro-code'));
    fs.writeFileSync(path.join(root, '.pro-code', 'semantic-refactor.lock'), 'already held');
    assert.throws(() => applyCodeFix(plan), /EEXIST/);
    assert.equal(read(root, 'main.ts'), 'rocketLaunch();\n');
  } finally { clean(root); }
});

test('CLI can list, preview and apply compiler fixes with machine-readable JSON', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'rocketLaunch();\n' });
  const cli = fileURLToPath(new URL('./code-fix.mjs', import.meta.url));
  try {
    const base = [cli, '--root', root, '--file', 'src/main.ts'];
    const listing = JSON.parse(execFileSync(process.execPath, base, { encoding: 'utf8' }));
    const action = listing.diagnostics.find(d => d.code === 2304).actions.find(a => !a.requires_commands);
    assert.ok(action);
    const preview = JSON.parse(execFileSync(process.execPath, [...base, '--code', '2304', '--fix-index', String(action.fix_index)], { encoding: 'utf8' }));
    assert.equal(preview.mode, 'preview');
    const applied = JSON.parse(execFileSync(process.execPath, [...base, '--code', '2304', '--fix-index', String(action.fix_index), '--apply'], { encoding: 'utf8' }));
    assert.equal(applied.mode, 'applied');
    assert.match(read(root, 'main.ts'), /import/);
    const bad = spawnSync(process.execPath, [...base, '--code', '2304', '--apply'], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
  } finally { clean(root); }
});
