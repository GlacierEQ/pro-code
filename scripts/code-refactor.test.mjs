import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { applyCodeRename, planCodeRename } from './code-refactor.mjs';

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pro-code-refactor-'));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, module: 'ESNext', moduleResolution: 'Bundler', target: 'ES2022', noEmit: true }, include: ['src/**/*.ts'],
  }));
  for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(root, 'src', name), contents);
  return root;
}
const read = (root, file) => readFileSync(path.join(root, 'src', file), 'utf8');
const dispose = root => rmSync(root, { recursive: true, force: true });
const options = root => ({ root, file: 'src/math.ts', line: 1, column: 17, newName: 'sumValues' });

test('rename exported function, imports, call sites with cross-file compiler semantics', () => {
  const root = fixture({
    'math.ts': 'export function add(a: number, b: number) { return a + b; }\n',
    'use.ts': "import { add } from './math';\nexport const result = add(2, 3);\n",
  });
  try {
    const plan = planCodeRename(options(root));
    assert.equal(plan.mode, 'preview');
    assert.equal(plan.file_count, 2);
    assert.ok(plan.edit_count >= 3);
    assert.equal(read(root, 'math.ts').includes('add('), true, 'preview must not mutate');
    const result = applyCodeRename(plan);
    assert.equal(result.mode, 'applied');
    assert.equal(result.readback_verified, true);
    assert.match(read(root, 'math.ts'), /function sumValues/);
    assert.match(read(root, 'use.ts'), /import \{ sumValues \}/);
    assert.match(read(root, 'use.ts'), /sumValues\(2, 3\)/);
  } finally { dispose(root); }
});

test('protects source files from stale previews before any writes', () => {
  const root = fixture({ 'math.ts': 'export function add(a: number, b: number) { return a + b; }\n', 'use.ts': "import { add } from './math';\nadd(2, 3);\n" });
  try {
    const plan = planCodeRename(options(root));
    writeFileSync(path.join(root, 'src', 'use.ts'), "import { add } from './math';\nadd(2, 4);\n");
    assert.throws(() => applyCodeRename(plan), /source changed after preview/);
    assert.match(read(root, 'math.ts'), /function add/);
    assert.match(read(root, 'use.ts'), /add\(2, 4\)/);
  } finally { dispose(root); }
});

test('restores earlier changed files on a later write failure', () => {
  const root = fixture({ 'math.ts': 'export function add(a: number, b: number) { return a + b; }\n', 'use.ts': "import { add } from './math';\nadd(2, 3);\n" });
  try {
    const plan = planCodeRename(options(root));
    assert.throws(() => applyCodeRename(plan, { beforeWrite: (_file, index) => { if (index === 1) throw new Error('injected outage'); } }), /injected outage/);
    assert.match(read(root, 'math.ts'), /function add/);
    assert.match(read(root, 'use.ts'), /import \{ add \}/);
  } finally { dispose(root); }
});

test('rejects invalid symbol renames and out-of-scope locations', () => {
  const root = fixture({ 'math.ts': 'export function add(a: number, b: number) { return a + b; }\n' });
  const outside = mkdtempSync(path.join(os.tmpdir(), 'pro-code-refactor-outside-'));
  writeFileSync(path.join(outside, 'outside.ts'), 'export const stolen = 1;');
  try {
    assert.throws(() => planCodeRename({ ...options(root), newName: 'return' }), /non-keyword/);
    assert.throws(() => planCodeRename({ ...options(root), newName: 'hello world' }), /non-keyword/);
    assert.throws(() => planCodeRename({ ...options(root), line: 0 }), /cursor requires/);
    assert.throws(() => planCodeRename({ ...options(root), file: '../outside.ts' }), /escapes workspace/);
    symlinkSync(path.join(outside, 'outside.ts'), path.join(root, 'src', 'link.ts'));
    assert.throws(() => planCodeRename({ ...options(root), file: 'src/link.ts' }), /not a regular workspace file/);
  } finally { dispose(root); dispose(outside); }
});

test('rename excludes unrelated same-spelling symbols', () => {
  const root = fixture({
    'math.ts': 'export function add(a: number, b: number) { return a + b; }\n',
    'use.ts': "import { add } from './math';\nconst outer = add(1, 2);\nfunction f() { const add = 10; return add; }\n",
  });
  try {
    const plan = planCodeRename(options(root));
    applyCodeRename(plan);
    assert.match(read(root, 'use.ts'), /function f\(\) \{ const add = 10; return add;/);
    assert.match(read(root, 'use.ts'), /sumValues\(1, 2\)/);
  } finally { dispose(root); }
});

test('bound limits and CLI JSON are implemented', () => {
  const root = fixture({ 'math.ts': 'export function add(a: number, b: number) { return a + b; }\n' });
  const cli = fileURLToPath(new URL('./code-refactor.mjs', import.meta.url));
  try {
    assert.throws(() => planCodeRename({ ...options(root), maxEdits: 0 }), /configured change bounds/);
    const preview = JSON.parse(execFileSync(process.execPath, [cli, '--root', root, '--file', 'src/math.ts', '--line', '1', '--column', '17', '--new-name', 'sumValues'], { encoding: 'utf8' }));
    assert.equal(preview.operation, 'typescript_safe_rename');
    assert.equal(preview.mode, 'preview');
    assert.match(read(root, 'math.ts'), /function add/);
  } finally { dispose(root); }
});
