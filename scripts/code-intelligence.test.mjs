import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
import { analyzeCodebase } from './code-intelligence.mjs';

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pro-code-analysis-'));
  await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noEmit: true }, include: ['src/**/*.ts'] }));
  await mkdir(path.join(root, 'src'));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, 'src', name), content);
  return root;
}

test('resolves transitive dependents using TypeScript AST and compiler module resolution', async () => {
  const root = await fixture({
    'base.ts': 'export const answer = 42;\n',
    'middle.ts': "import { answer } from './base'; export const doubled = answer * 2;\n",
    'main.ts': "import { doubled } from './middle'; export const result = doubled;\n",
    'isolated.ts': 'export const unrelated = true;\n',
  });
  try {
    const result = await analyzeCodebase({ root, impact: 'src/base.ts' });
    assert.equal(result.scope.source_file_count, 4);
    assert.deepEqual(result.impact.affected_files, ['src/base.ts', 'src/main.ts', 'src/middle.ts']);
    assert.equal(result.findings.diagnostic_count, 0);
    assert.equal(result.findings.unresolved_import_count, 0);
    const base = result.files.find(file => file.path === 'src/base.ts');
    assert.ok(base, 'base file should be part of the program');
    assert.deepEqual(base.exports, ['answer']);
    const middle = result.files.find(file => file.path === 'src/middle.ts');
    assert.ok(middle, 'importing file should be part of the program');
    assert.equal(middle.imports[0].status, 'internal');
    assert.equal(middle.imports[0].target, 'src/base.ts');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('reports exact compiler errors and unresolved imports rather than reporting success', async () => {
  const root = await fixture({
    'broken.ts': "import { missing } from './does-not-exist'; export const count: number = 'invalid';\n",
  });
  try {
    const result = await analyzeCodebase({ root });
    assert.ok(result.findings.diagnostic_count >= 2);
    assert.equal(result.findings.unresolved_import_count, 1);
    assert.ok(result.diagnostics.some(x => x.code === 2307));
    assert.ok(result.diagnostics.some(x => x.code === 2322));
    assert.equal(result.files.length, 1, 'broken source file should be indexed');
    assert.equal(result.files[0].imports[0].status, 'unresolved');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('records nonliteral dynamic imports as incomplete dependency knowledge', async () => {
  const root = await fixture({ 'loader.ts': 'export async function load(name: string) { return import(name); }\n' });
  try {
    const result = await analyzeCodebase({ root });
    assert.equal(result.findings.dynamic_unknown_count, 1);
    assert.equal(result.files.length, 1, 'dynamic module should be indexed');
    assert.equal(result.files[0].imports[0].status, 'dynamic-unknown');
    assert.equal(result.files[0].imports[0].target, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects unknown impact targets rather than fabricating an empty graph', async () => {
  const root = await fixture({ 'one.ts': 'export const one = 1;\n' });
  try {
    await assert.rejects(() => analyzeCodebase({ root, impact: 'src/missing.ts' }), /not included in the TypeScript program/);
    await assert.rejects(() => analyzeCodebase({ root, config: '../outside.json' }), /must remain inside the workspace/);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('CLI analyzes a real fixture and writes its machine-readable report in a new directory', async () => {
  const root = await fixture({ 'one.ts': 'export const value = 42;\n' });
  try {
    const cli = fileURLToPath(new URL('./code-intelligence.mjs', import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [cli, '--root', root, '--impact', 'src/one.ts', '--out', 'reports/impact.json', '--fail-on-diagnostics']);
    const output = await readFile(path.join(root, 'reports', 'impact.json'), 'utf8');
    assert.equal(stdout, output);
    const report = JSON.parse(output);
    assert.equal(report.operation, 'typescript_program_analysis');
    assert.deepEqual(report.impact.affected_files, ['src/one.ts']);
    assert.equal(report.findings.diagnostic_count, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('resolves import type references and literal dynamic imports with options', async () => {
  const root = await fixture({
    'base.ts': 'export interface Answer { n: number }\n',
    'type-user.ts': "export type Result = import('./base').Answer;\n",
    'dynamic.ts': "export async function load() { return import('./base', { with: { type: 'javascript' } }); }\n",
  });
  try {
    const result = await analyzeCodebase({ root, impact: 'src/base.ts' });
    assert.deepEqual(result.impact.affected_files, ['src/base.ts', 'src/dynamic.ts', 'src/type-user.ts']);
    assert.equal(result.findings.diagnostic_count, 0);
    assert.equal(result.findings.dynamic_unknown_count, 0);
    assert.equal(result.files.find(x => x.path === 'src/type-user.ts')?.imports[0].kind, 'import-type');
    assert.equal(result.files.find(x => x.path === 'src/type-user.ts')?.imports[0].status, 'internal');
    assert.equal(result.files.find(x => x.path === 'src/dynamic.ts')?.imports[0].status, 'internal');
  } finally { await rm(root, { recursive: true, force: true }); }
});
