import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { queryCodeKnowledge } from './code-knowledge.mjs';

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pro-code-knowledge-'));
  await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noEmit: true },
    include: ['src/**/*.ts'],
  }));
  await mkdir(path.join(root, 'src'));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, 'src', name), content);
  return root;
}

const examples = {
  'api.ts': 'export function transform(n: number): number { return n + 1; }\n',
  'consumer.ts': "import { transform } from './api'; export const answer = transform(4);\n",
  'other.ts': "function transform(value: string) { return value.toUpperCase(); } export const result = transform('ok');\n",
};

test('groups same-spelled symbols by semantic declarations, not guesswork', async () => {
  const root = await fixture(examples);
  try {
    const result = await queryCodeKnowledge({ root, symbol: 'transform' });
    assert.equal(result.findings.binding_count, 2);
    assert.equal(result.findings.ambiguous_name, true);
    assert.equal(result.findings.unresolved_identifiers, 0);
    assert.equal(result.findings.compiler_diagnostics, 0);
    const fromApi = result.bindings.find(group => group.declarations.some(x => x.file === 'src/api.ts'));
    assert.ok(fromApi, 'exported symbol declaration must be located');
    assert.ok(fromApi.occurrences.some(x => x.file === 'src/consumer.ts' && x.role === 'reference'));
    const fromOther = result.bindings.find(group => group.declarations.some(x => x.file === 'src/other.ts'));
    assert.ok(fromOther, 'local symbol declaration must stay independent');
    assert.ok(fromOther.occurrences.every(x => x.file === 'src/other.ts'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('definition-file narrows ambiguous symbols without discarding external references', async () => {
  const root = await fixture(examples);
  try {
    const report = await queryCodeKnowledge({ root, symbol: 'transform', definitionFile: 'src/api.ts', impact: 'src/api.ts' });
    assert.equal(report.findings.binding_count, 1);
    assert.equal(report.findings.ambiguous_name, false);
    assert.deepEqual(report.impact.affected_files, ['src/api.ts', 'src/consumer.ts']);
    const refs = report.bindings[0].occurrences;
    assert.ok(refs.some(x => x.file === 'src/api.ts' && x.role === 'definition'));
    assert.ok(refs.some(x => x.file === 'src/consumer.ts' && x.role === 'reference'));
    assert.ok(refs.every(x => x.line >= 1 && x.column >= 1));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unknown symbols and out-of-workspace definition files never get fabricated locations', async () => {
  const root = await fixture({ 'known.ts': 'export const known = 1;\n' });
  try {
    const unknown = await queryCodeKnowledge({ root, symbol: 'doesNotExist' });
    assert.equal(unknown.findings.symbol_found, false);
    assert.deepEqual(unknown.bindings, []);
    await assert.rejects(() => queryCodeKnowledge({ root, symbol: 'known', definitionFile: '../outside.ts' }), /inside the workspace/);
    await assert.rejects(() => queryCodeKnowledge({ root, symbol: '' }), /nonempty --symbol/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('compiler errors are preserved in code knowledge reports rather than hidden', async () => {
  const root = await fixture({ 'broken.ts': "export const counter: number = 'invalid';\n" });
  try {
    const report = await queryCodeKnowledge({ root, symbol: 'counter' });
    assert.equal(report.findings.symbol_found, true);
    assert.ok(report.findings.compiler_diagnostics > 0);
    assert.ok(report.diagnostics.some(x => x.code === 2322));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI writes inspectable JSON to new directories, returns failure for nonexistent symbol', async () => {
  const root = await fixture(examples);
  const cli = fileURLToPath(new URL('./code-knowledge.mjs', import.meta.url));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [
      cli, '--root', root, '--symbol', 'transform', '--definition-file', 'src/api.ts',
      '--out', '.pro-code/runtime/symbols.json', '--fail-on-diagnostics',
    ]);
    const saved = await readFile(path.join(root, '.pro-code/runtime/symbols.json'), 'utf8');
    assert.equal(stdout, saved);
    assert.equal(JSON.parse(saved).findings.binding_count, 1);
    await assert.rejects(
      () => promisify(execFile)(process.execPath, [cli, '--root', root, '--symbol', 'notKnown']),
      error => error.code === 1 && JSON.parse(error.stdout).findings.symbol_found === false,
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('symbol knowledge refuses symlinked definition input and output destinations', async () => {
  const root = await fixture({ 'main.ts': 'export const main = true;\n' });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'pro-code-knowledge-outside-'));
  const cli = fileURLToPath(new URL('./code-knowledge.mjs', import.meta.url));
  try {
    await writeFile(path.join(outside, 'external.ts'), 'export const main = false;\n');
    await symlink(path.join(outside, 'external.ts'), path.join(root, 'src', 'linked.ts'));
    await assert.rejects(() => queryCodeKnowledge({ root, symbol: 'main', definitionFile: 'src/linked.ts' }), /outside the workspace/);
    await rm(path.join(root, 'src', 'linked.ts'));
    await symlink(outside, path.join(root, 'reports'));
    await assert.rejects(promisify(execFile)(process.execPath, [
      cli, '--root', root, '--symbol', 'main', '--out', 'reports/result.json',
    ]), error => error.code === 1 && /Output directory/.test(error.stderr));
    await assert.rejects(readFile(path.join(outside, 'result.json')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
