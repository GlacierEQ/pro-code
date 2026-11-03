import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
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

test('indexes CommonJS require and require.resolve as transitive dependency edges', async () => {
  const root = await fixture({
    'base.ts': 'export const answer = 42;\n',
    'middle.ts': "declare const require: (name: string) => any; const base = require('./base'); export const doubled = base.answer * 2;\n",
    'main.ts': "declare const require: { resolve(name: string): string }; export const location = require.resolve('./middle');\n",
  });
  try {
    const result = await analyzeCodebase({ root, impact: 'src/base.ts' });
    assert.deepEqual(result.impact.affected_files, ['src/base.ts', 'src/main.ts', 'src/middle.ts']);
    assert.equal(result.scope.analysis_complete, true);
    assert.equal(result.findings.diagnostic_count, 0);
    assert.equal(result.files.find(x => x.path === 'src/middle.ts').imports[0].kind, 'require');
    assert.equal(result.files.find(x => x.path === 'src/main.ts').imports[0].kind, 'require-resolve');
    assert.equal(result.files.find(x => x.path === 'src/main.ts').imports[0].target, 'src/middle.ts');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('reports dynamic require paths as incomplete and CLI can reject an incomplete graph', async () => {
  const root = await fixture({
    'dynamic.ts': "declare const require: (name: string) => unknown; export function load(name: string) { return require(name); }\n",
  });
  try {
    const result = await analyzeCodebase({ root });
    assert.equal(result.findings.dynamic_unknown_count, 1);
    assert.equal(result.scope.analysis_complete, false);
    assert.equal(result.files[0].imports[0].kind, 'require');
    assert.equal(result.files[0].imports[0].status, 'dynamic-unknown');
    const cli = fileURLToPath(new URL('./code-intelligence.mjs', import.meta.url));
    await assert.rejects(
      promisify(execFile)(process.execPath, [cli, '--root', root, '--out', 'reports/impact.json', '--fail-on-incomplete']),
      error => error.code === 1,
    );
    const report = JSON.parse(await readFile(path.join(root, 'reports/impact.json'), 'utf8'));
    assert.equal(report.scope.analysis_complete, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('does not falsely mark unresolved static CommonJS imports as complete', async () => {
  const root = await fixture({
    'broken.ts': "declare const require: (name: string) => unknown; export const missing = require('./absent');\n",
  });
  try {
    const result = await analyzeCodebase({ root });
    assert.equal(result.findings.unresolved_import_count, 1);
    assert.equal(result.scope.analysis_complete, false);
    assert.equal(result.files[0].imports[0].status, 'unresolved');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects symlinked tsconfig and source paths that escape the workspace', async () => {
  const root = await fixture({ 'main.ts': 'export const main = true;\n' });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'pro-code-outside-'));
  try {
    await writeFile(path.join(outside, 'external.json'), JSON.stringify({ include: ['**/*.ts'] }));
    await symlink(path.join(outside, 'external.json'), path.join(root, 'config-link.json'));
    await assert.rejects(() => analyzeCodebase({ root, config: 'config-link.json' }), /outside the workspace/);
    await writeFile(path.join(outside, 'external.ts'), 'export const secret = 1;\n');
    await symlink(path.join(outside, 'external.ts'), path.join(root, 'src', 'linked.ts'));
    await assert.rejects(() => analyzeCodebase({ root }), /outside the workspace/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('CLI never writes output through a symlinked report directory', async () => {
  const root = await fixture({ 'main.ts': 'export const main = true;\n' });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'pro-code-output-outside-'));
  const cli = fileURLToPath(new URL('./code-intelligence.mjs', import.meta.url));
  try {
    await symlink(outside, path.join(root, 'reports'));
    await assert.rejects(promisify(execFile)(process.execPath, [
      cli, '--root', root, '--out', 'reports/result.json',
    ]), error => error.code === 1 && /Output directory/.test(error.stderr));
    await assert.rejects(readFile(path.join(outside, 'result.json')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('compiler errors cannot be represented as a complete analysis', async () => {
  const root = await fixture({ 'broken.ts': "export const n: number = 'not a number';\n" });
  try {
    const result = await analyzeCodebase({ root });
    assert.ok(result.findings.diagnostic_count > 0);
    assert.equal(result.scope.analysis_complete, false);
    const cli = fileURLToPath(new URL('./code-intelligence.mjs', import.meta.url));
    await assert.rejects(
      promisify(execFile)(process.execPath, [cli, '--root', root, '--fail-on-incomplete']),
      error => error.code === 1,
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local declaration imports outside the source index do not vanish into external success', async () => {
  const root = await fixture({
    'main.ts': "import type { Value } from './values'; export const item: Value = { n: 2 };\n",
    'values.d.ts': 'export interface Value { n: number }\n',
  });
  try {
    const result = await analyzeCodebase({ root });
    const item = result.files.find(x => x.path === 'src/main.ts');
    assert.equal(item.imports[0].status, 'internal-unindexed');
    assert.equal(item.imports[0].target, 'src/values.d.ts');
    assert.equal(result.findings.unindexed_internal_import_count, 1);
    assert.equal(result.findings.diagnostic_count, 0);
    assert.equal(result.scope.analysis_complete, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('impact chains expose deterministic shortest causes in a diamond', async () => {
  const root = await fixture({
    'base.ts': 'export const seed = 1;\n',
    'left.ts': "import { seed } from './base'; export const left = seed + 1;\n",
    'right.ts': "import { seed } from './base'; export const right = seed + 2;\n",
    'top.ts': "import { left } from './left'; import { right } from './right'; export const total = left + right;\n",
  });
  try {
    const report = await analyzeCodebase({ root, impact: 'src/base.ts' });
    assert.deepEqual(report.impact.direct_dependents, ['src/left.ts', 'src/right.ts']);
    assert.deepEqual(report.impact.dependency_paths['src/top.ts'], ['src/base.ts', 'src/left.ts', 'src/top.ts']);
    assert.deepEqual(Object.keys(report.impact.dependency_paths).sort(), report.impact.affected_files);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local require helpers do not create false module edges', async () => {
  const root = await fixture({
    'base.ts': 'export const answer = 1;\n',
    'local.ts': "const require = (name: string) => name; export const fake = require('./base');\n",
    'param.ts': "export function injected(require: (name: string) => string) { return require('./base'); }\n",
    'real.ts': "declare const require: (name: string) => any; export const actual = require('./base');\n",
  });
  try {
    const report = await analyzeCodebase({ root, impact: 'src/base.ts' });
    assert.equal(report.files.find(file => file.path === 'src/local.ts').imports.length, 0);
    assert.equal(report.files.find(file => file.path === 'src/param.ts').imports.length, 0);
    assert.deepEqual(report.impact.affected_files, ['src/base.ts', 'src/real.ts']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('one compiler program snapshot is exposed to downstream analysis consumers', async () => {
  const root = await fixture({
    'source.ts': 'export const value: number = 7;\n',
    'reader.ts': "import { value } from './source'; export const answer = value + 1;\n",
  });
  try {
    const programs = [];
    const result = await analyzeCodebase({
      root, impact: 'src/source.ts', onProgram: program => programs.push(program),
    });
    assert.equal(programs.length, 1);
    const program = programs[0];
    assert.equal(typeof program.getTypeChecker, 'function');
    assert.ok(program.getSourceFiles().some(file => file.fileName.endsWith('src/source.ts')));
    assert.deepEqual(result.impact.affected_files, ['src/reader.ts', 'src/source.ts']);
    assert.equal(result.findings.diagnostic_count, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid compiler callback is rejected without silently ignoring it', async () => {
  const root = await fixture({ 'one.ts': 'export const value = 1;\n' });
  try {
    await assert.rejects(() => analyzeCodebase({ root, onProgram: true }), /onProgram must be a function/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
