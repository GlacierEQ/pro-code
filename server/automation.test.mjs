import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { createHash } from 'node:crypto';
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
  const handled = await automation.executeCapability('inventoryWorkspace', { source: 'test' });
  assert.equal(handled.handled, true);
  assert.equal(handled.operation, 'workspace_inventory');
  assert.equal(handled.objective_completed, true);
  assert.equal(handled.verified, true);
  assert.equal(handled.summary.inventory_complete, true);
  assert.equal(handled.parameters_received, 1);
  assert.ok(handled.summary.file_count >= 3);
  assert.match(handled.artifacts.report, /workspace-report\.md$/);

  const passive = await automation.executeCapability('analyzeCase', {});
  assert.equal(passive.handled, false);
  assert.equal((await automation.executeCapability('generateBatchMotions', {})).handled, false);
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

test('incomplete max-file scan fails rather than claiming a complete manifest', async () => {
  const root = await fixture();
  const automation = new WorkspaceAutomation({ workspaceRoot: root, env: { PRO_CODE_MAX_FILES: '2' } });
  await assert.rejects(() => automation.run('test'), /scan incomplete: exceeded PRO_CODE_MAX_FILES/);
  assert.equal(automation.getStatus().state, 'error');
  assert.equal(automation.getStatus().latest, null);
});

test('bounded hashing overlaps file I/O while preserving complete digest and duplicate evidence', async () => {
  const root = await fixture();
  let active = 0;
  let peak = 0;
  const hashFile = async file => {
    active += 1;
    peak = Math.max(peak, active);
    try {
      await Promise.resolve();
      return createHash('sha256').update(await readFile(file)).digest('hex');
    } finally {
      active -= 1;
    }
  };
  const automation = new WorkspaceAutomation({
    workspaceRoot: root,
    env: { PRO_CODE_HASH_CONCURRENCY: '2' },
    hashFile,
    now: () => new Date('2026-08-06T08:00:00.000Z'),
  });
  const status = await automation.run('parallel-hash');
  const manifest = JSON.parse(await readFile(status.latest.manifest_path, 'utf8'));
  assert.equal(peak, 2, 'multiple files hash concurrently, bounded by configuration');
  assert.equal(manifest.summary.hash_complete, true);
  assert.equal(manifest.summary.hashed_files, 3);
  assert.deepEqual(manifest.files.map(file => file.path), ['README.md', 'case/Docket-Order-Exhibit.txt', 'case/copy.txt']);
  assert.equal(manifest.duplicates[0].copies, 2);
  for (const file of manifest.files) {
    const actual = createHash('sha256').update(await readFile(path.join(root, file.path))).digest('hex');
    assert.equal(file.sha256, actual, `digest mismatch for ${file.path}`);
  }
});

test('concurrent scan rejects files changed during hashing instead of publishing false completeness', async () => {
  const root = await fixture();
  const automation = new WorkspaceAutomation({
    workspaceRoot: root,
    env: { PRO_CODE_HASH_CONCURRENCY: '3' },
    hashFile: async file => {
      if (file.endsWith('README.md')) await writeFile(file, 'changed while being hashed');
      return createHash('sha256').update(await readFile(file)).digest('hex');
    },
  });
  await assert.rejects(() => automation.run('mutating-file'), /Workspace scan incomplete: 1 files could not be hashed reliably/);
  assert.equal(automation.getStatus().state, 'error');
  assert.equal(automation.getStatus().latest, null);
});
