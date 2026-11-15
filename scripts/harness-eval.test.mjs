import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { evaluateHarness } from './harness-eval.mjs';

test('actual local HTTP ablation measures a reproducible durability gain with no model claim', async () => {
  const result = await evaluateHarness({ revision: 'unit-test-revision' });
  assert.equal(result.schema_version, 'glaciereq.pro-code.harness-eval.v1');
  assert.equal(result.evaluation_kind, 'hermetic_real_http_ablation');
  assert.equal(result.scope, 'local_fixture_only');
  assert.equal(result.source_revision, 'unit-test-revision');
  assert.equal(result.model, null);
  assert.equal(result.model_weights_changed, false);
  assert.match(result.dataset_sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.compared.baseline.total, 7);
  assert.equal(result.compared.candidate.total, 7);
  assert.equal(result.compared.baseline.passed, 4);
  assert.equal(result.compared.candidate.passed, 7);
  assert.equal(result.compared.delta_correct_cases, 3);
  assert.equal(result.compared.baseline.worker_executions, 7);
  assert.equal(result.compared.candidate.worker_executions, 4);
  assert.equal(result.result, 'local_ablation_improvement_verified');
  const byId = entries => new Map(entries.map(entry => [entry.case_id, entry]));
  const bare = byId(result.cases.baseline);
  const durable = byId(result.cases.candidate);
  for (const id of ['restart_replay', 'restart_conflict', 'uncertain_claim']) {
    assert.equal(bare.get(id).correct, false);
    assert.equal(durable.get(id).correct, true);
  }
  assert.equal(durable.get('uncertain_claim').status, 409);
  assert.equal(durable.get('uncertain_claim').worker_executions, 0);
  assert.equal(durable.get('restart_replay').replayed, true);
  assert.equal(durable.get('restart_conflict').second_status, 409);
  assert.equal(durable.get('foreign_origin').status, 403);
  assert.equal(durable.get('unsupported_capability').status, 501);
});

test('CLI emits inspectable JSON, writes exactly selected evidence path and fails invalid arguments', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pro-code-eval-cli-'));
  const output = path.join(root, 'metrics.json');
  const cli = fileURLToPath(new URL('./harness-eval.mjs', import.meta.url));
  try {
    const stdout = execFileSync(process.execPath, [cli, '--strict', '--out', output], {
      encoding: 'utf8', timeout: 60_000,
    });
    const emitted = JSON.parse(stdout);
    const persisted = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual(persisted, emitted);
    assert.equal(persisted.result, 'local_ablation_improvement_verified');
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    const invalid = spawnSync(process.execPath, [cli, '--out'], { encoding: 'utf8', timeout: 10_000 });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /requires an explicit file path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
