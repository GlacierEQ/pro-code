import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { WorkspaceAutomation } from './automation.mjs';

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pro-code-auto-'));
  roots.push(root);
  await mkdir(path.join(root, 'case'), { recursive: true });
  await writeFile(path.join(root, 'case', 'Docket-Order-Exhibit.txt'), 'alpha');
  await writeFile(path.join(root, 'case', 'copy.txt'), 'alpha');
  await writeFile(path.join(root, 'README.md'), '# Test');
  return root;
}

test('automatic run creates deterministic manifest and report artifacts', async () => {
  const root = await fixture();
  const automation = new WorkspaceAutomation({
    workspaceRoot: root,
    env: { PRO_CODE_AUTOMATION_INTERVAL_MS: '5000' },
    now: () => new Date('2026-08-06T08:00:00.000Z'),
  });

  const status = await automation.run('test');
  assert.equal(status.state, 'idle');
  assert.equal(status.latest.file_count, 3);
  assert.equal(status.latest.duplicate_groups, 1);
  assert.ok(status.latest.high_value_candidates >= 1);

  const manifest = JSON.parse(await readFile(status.latest.manifest_path, 'utf8'));
  assert.equal(manifest.summary.file_count, 3);
  assert.equal(manifest.changes.added.length, 3);
  assert.equal(manifest.duplicates[0].copies, 2);
  assert.equal(manifest.high_value_candidates[0].path, 'case/Docket-Order-Exhibit.txt');

  const report = await readFile(status.latest.report_path, 'utf8');
  assert.match(report, /Automatic Workspace Report/);
  assert.match(report, /Docket-Order-Exhibit\.txt/);
});

test('subsequent run records added modified and removed files', async () => {
  const root = await fixture();
  let tick = 0;
  const automation = new WorkspaceAutomation({
    workspaceRoot: root,
    env: {},
    now: () => new Date(`2026-08-06T08:00:0${tick++}.000Z`),
  });
  await automation.run('baseline');
  await writeFile(path.join(root, 'README.md'), '# Changed');
  await rm(path.join(root, 'case', 'copy.txt'));
  await writeFile(path.join(root, 'case', 'new-motion.pdf'), 'new');

  const status = await automation.run('delta');
  const manifest = JSON.parse(await readFile(status.latest.manifest_path, 'utf8'));
  assert.deepEqual(manifest.changes.added, ['case/new-motion.pdf']);
  assert.deepEqual(manifest.changes.modified, ['README.md']);
  assert.deepEqual(manifest.changes.removed, ['case/copy.txt']);
});

test('capability execution runs the useful automation pipeline', async () => {
  const root = await fixture();
  const automation = new WorkspaceAutomation({ workspaceRoot: root, env: {} });
  const handled = await automation.executeCapability('analyzeCase', { source: 'test' });
  assert.equal(handled.handled, true);
  assert.equal(handled.parameters_received, 1);
  assert.ok(handled.summary.file_count >= 3);
  assert.match(handled.artifacts.report, /workspace-report\.md$/);

  const passive = await automation.executeCapability('executeAPI', {});
  assert.equal(passive.handled, false);
  assert.ok(passive.summary);
});

test('disabled scheduler stays disabled but manual run remains available', async () => {
  const root = await fixture();
  const automation = new WorkspaceAutomation({
    workspaceRoot: root,
    env: { PRO_CODE_AUTOMATION_ENABLED: 'false' },
  });
  automation.start();
  assert.equal(automation.getStatus().state, 'disabled');
  const status = await automation.run('manual');
  assert.equal(status.state, 'idle');
  assert.equal(status.run_count, 1);
});
