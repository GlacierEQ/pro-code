import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startAutomaticRuntime } from './automatic-runtime.mjs';

function dispatchEnvelope(capability, taskId) {
  return {
    schema_version: '1.0.0',
    case_id: 'CASE-AUTO-TEST',
    trace_id: `trace-${taskId}`,
    task_id: taskId,
    idempotency_key: `idem-${taskId}`,
    priority: 'normal',
    constraints: {
      human_review_required: true,
      external_actions: 'forbidden',
      max_runtime_ms: 30_000,
      allowed_tools: [],
      source_refs: [],
    },
    producer: { system: 'pro-code', component: 'automatic-runtime-test', version: '1.0.0' },
    worker: capability === 'inventoryWorkspace' ? 'automation-orchestrator'
      : capability === 'generateBatchMotions' ? 'motion-generator' : 'case-analyzer',
    capability,
    params: { source: 'runtime-test' },
    created_at: '2026-08-06T08:00:00.000Z',
  };
}

async function dispatch(runtime, capability, taskId) {
  const body = dispatchEnvelope(capability, taskId);
  return fetch(`${runtime.url}/api/v1/workers/${body.worker}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': body.idempotency_key,
      'X-Case-Id': body.case_id,
      'X-Trace-Id': body.trace_id,
    },
    body: JSON.stringify(body),
  });
}

test('default runtime starts Nexus and completes automatic workspace intelligence', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'pro-code-runtime-'));
  await writeFile(path.join(workspaceRoot, 'Hearing-Exhibit.txt'), 'verified fixture');
  const runtime = await startAutomaticRuntime({
    env: {
      PRO_CODE_HOST: '127.0.0.1',
      PRO_CODE_PORT: '0',
      PRO_CODE_WORKSPACE_DIR: workspaceRoot,
      PRO_CODE_AUTOMATION_ENABLED: 'true',
      PRO_CODE_AUTOMATION_INTERVAL_MS: '5000',
    },
  });

  try {
    const status = await runtime.startup;
    assert.equal(status.state, 'idle');
    assert.equal(status.latest.file_count, 1);
    assert.equal(status.latest.high_value_candidates, 1);

    const manifest = JSON.parse(await readFile(status.latest.manifest_path, 'utf8'));
    assert.equal(manifest.files[0].path, 'Hearing-Exhibit.txt');
    assert.equal(manifest.files[0].hash_status, 'hashed');

    const healthResponse = await fetch(`${runtime.url}/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.status, 'ok');
    assert.equal(health.workers.length, 15);
    assert.equal(health.automation.latest.file_count, 1);

    const caseResponse = await dispatch(runtime, 'analyzeCase', 'case-analysis');
    assert.equal(caseResponse.status, 501);
    const caseResult = await caseResponse.json();
    assert.equal(caseResult.objective_completed, false);
    assert.equal(caseResult.receipt.automation_handled, false);

    const motionResponse = await dispatch(runtime, 'generateBatchMotions', 'motion-pipeline');
    assert.equal(motionResponse.status, 501);
    const motionResult = await motionResponse.json();
    assert.equal(motionResult.receipt.objective_completed, false);

    const inventoryResponse = await dispatch(runtime, 'inventoryWorkspace', 'workspace-inventory');
    assert.equal(inventoryResponse.status, 200);
    const inventoryResult = await inventoryResponse.json();
    assert.equal(inventoryResult.objective_completed, true);
    assert.equal(inventoryResult.operation, 'workspace_inventory');
    assert.equal(inventoryResult.receipt.evidence.inventory_complete, true);
    assert.equal(inventoryResult.receipt.evidence.files_indexed, 1);
    assert.equal(inventoryResult.automation.handled, true);
    assert.match(inventoryResult.automation.artifacts.report, /workspace-report\.md$/);

    const statusResponse = await fetch(`${runtime.url}/api/v1/automation/status`);
    assert.equal(statusResponse.status, 200);
    const current = await statusResponse.json();
    assert.ok(current.automation.run_count >= 2);
  } finally {
    await runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
