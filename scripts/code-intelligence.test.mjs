import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
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
    assert.deepEqual(base.exports, ['answer']);
    const middle = result.files.find(file => file.path === 'src/middle.ts');
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
    assert.equal(result.files[0].imports[0].status, 'unresolved');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('records nonliteral dynamic imports as incomplete dependency knowledge', async () => {
  const root = await fixture({ 'loader.ts': 'export async function load(name: string) { return import(name); }\n' });
  try {
    const result = await analyzeCodebase({ root });
    assert.equal(result.findings.dynamic_unknown_count, 1);
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

