import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startNexusServer } from './nexus.mjs';

let server;
let baseUrl;

before(async () => {
  const started = await startNexusServer({ host: '127.0.0.1', port: 0 });
  server = started.server;
  baseUrl = started.url;
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

function envelope(overrides = {}) {
  return {
    schema_version: '1.0.0',
    case_id: 'CASE-TEST-1',
    trace_id: 'trace-1',
    task_id: 'task-1',
    idempotency_key: 'idem-1',
    priority: 'normal',
    constraints: {
      human_review_required: true,
      external_actions: 'forbidden',
      max_runtime_ms: 30_000,
      allowed_tools: [],
      source_refs: [],
    },
    producer: { system: 'pro-code', component: 'test', version: '1.0.0' },
    worker: 'case-analyzer',
    capability: 'analyzeCase',
    params: { source: 'fixture' },
    created_at: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

async function dispatch(body, targetUrl = baseUrl) {
  return fetch(`${targetUrl}/api/v1/workers/${body.worker}/execute`, {
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

test('health exposes the complete local worker runtime', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.runtime.status, 'ok');
  assert.equal(body.workers.length, 15);
  assert.ok(body.workers.includes('case-analyzer'));
});

test('registered capability without an executor cannot claim success', async () => {
  const response = await dispatch(envelope());
  assert.equal(response.status, 501);
  const body = await response.json();
  assert.equal(body.status, 'unsupported');
  assert.equal(body.success, false);
  assert.equal(body.receipt.status, 'unsupported');
  assert.equal(body.receipt.case_id, 'CASE-TEST-1');
  assert.equal(body.receipt.capability, 'analyzeCase');
  assert.match(body.error, /requested operation was not executed/);
});

test('identical idempotent replay returns the original receipt', async () => {
  const body = envelope({ task_id: 'task-replay', idempotency_key: 'idem-replay' });
  const first = await dispatch(body);
  const second = await dispatch(body);
  assert.equal(first.status, 501);
  assert.equal(second.status, 501);
  assert.equal(second.headers.get('x-idempotent-replay'), 'true');
  assert.deepEqual(await second.json(), await first.json());
});

test('idempotency key reuse with a different envelope fails closed', async () => {
  const first = envelope({ task_id: 'task-conflict-1', idempotency_key: 'idem-conflict' });
  const second = envelope({ task_id: 'task-conflict-2', idempotency_key: 'idem-conflict' });
  assert.equal((await dispatch(first)).status, 501);
  const response = await dispatch(second);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.match(body.error, /different envelope/);
});

test('concurrent identical dispatches execute once and conflicting replays reject', async () => {
  let invoked = 0;
  let release;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const runtime = await startNexusServer({
    host: '127.0.0.1',
    port: 0,
    automation: {
      async executeCapability() {
        invoked += 1;
        signalStarted();
        await held;
        return { handled: true, operation: 'workspace_inventory', verified: true, objective_completed: true, summary: { manifest_id: 'sha256-concurrency-fixture', inventory_complete: true, file_count: 2, hash_complete: true, hash_skipped_files: 0 }, artifacts: { manifest: '/fixture/workspace-manifest.json' } };
      },
    },
  });
  try {
    const body = envelope({ worker: 'automation-orchestrator', capability: 'inventoryWorkspace', task_id: 'task-concurrent', idempotency_key: 'idem-concurrent' });
    const first = dispatch(body, runtime.url);
    await started;
    const replay = dispatch(body, runtime.url);
    const conflict = await dispatch(envelope({
      worker: 'automation-orchestrator', capability: 'inventoryWorkspace',
      task_id: 'task-conflicting', idempotency_key: 'idem-concurrent',
    }), runtime.url);
    assert.equal(conflict.status, 409);
    release();
    const [firstResponse, replayResponse] = await Promise.all([first, replay]);
    assert.equal(firstResponse.status, 200);
    assert.equal(replayResponse.status, 200);
    assert.equal(invoked, 1);
    assert.equal(replayResponse.headers.get('x-idempotent-replay'), 'true');
    assert.deepEqual(await replayResponse.json(), await firstResponse.json());
  } finally {
    release();
    await new Promise((resolve, reject) => runtime.server.close(error => error ? reject(error) : resolve()));
  }
});

test('failed execution is not cached as a successful idempotent receipt', async () => {
  let invoked = 0;
  const runtime = await startNexusServer({
    host: '127.0.0.1',
    port: 0,
    automation: {
      async executeCapability() {
        invoked += 1;
        if (invoked === 1) throw new Error('fixture execution failure');
        return { handled: true, operation: 'workspace_inventory', verified: true, objective_completed: true, summary: { manifest_id: 'sha256-recovery-fixture', inventory_complete: true, file_count: 2, hash_complete: true, hash_skipped_files: 0 }, artifacts: { manifest: '/fixture/workspace-manifest.json' } };
      },
    },
  });
  try {
    const body = envelope({ worker: 'automation-orchestrator', capability: 'inventoryWorkspace', task_id: 'task-retry', idempotency_key: 'idem-retry' });
    const failure = await dispatch(body, runtime.url);
    assert.equal(failure.status, 500);
    assert.equal((await failure.json()).success, false);
    const recovered = await dispatch(body, runtime.url);
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).status, 'succeeded');
    assert.equal(invoked, 2);
  } finally {
    await new Promise((resolve, reject) => runtime.server.close(error => error ? reject(error) : resolve()));
  }
});

test('missing case context and unknown capability are rejected', async () => {
  const missingCase = envelope({ case_id: '' });
  const missingCaseResponse = await dispatch(missingCase);
  assert.equal(missingCaseResponse.status, 422);

  const unknown = envelope({ capability: 'fileCourtMotion' });
  const unknownResponse = await dispatch(unknown);
  assert.equal(unknownResponse.status, 422);
  const body = await unknownResponse.json();
  assert.match(body.error, /does not own capability/);
});

test('memory context endpoint stores and retrieves browser context', async () => {
  const write = await fetch(`${baseUrl}/context/session-1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { alpha: { value: 1 } } }),
  });
  assert.equal(write.status, 200);

  const read = await fetch(`${baseUrl}/context/session-1`);
  const body = await read.json();
  assert.deepEqual(body.data, { alpha: { value: 1 } });
});

test('filesystem sync is explicit when no destination is configured', async () => {
  const response = await fetch(`${baseUrl}/api/v1/memory/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'aspen', entries: [] }),
  });
  assert.equal(response.status, 501);
  const body = await response.json();
  assert.equal(body.status, 'unsupported');
});

test('attached inventory cannot impersonate legal analysis, motion generation, or AI execution', async () => {
  let invoked = 0;
  const runtime = await startNexusServer({
    host: '127.0.0.1', port: 0,
    automation: { async executeCapability() { invoked += 1; return { handled: true }; } },
  });
  try {
    for (const [capability, worker] of [
      ['analyzeCase', 'case-analyzer'], ['generateBatchMotions', 'motion-generator'],
      ['modelMaximize', 'ai-executor'],
    ]) {
      const response = await dispatch(envelope({
        worker, capability, task_id: `task-${capability}`, idempotency_key: `idem-${capability}`,
      }), runtime.url);
      assert.equal(response.status, 501);
      const body = await response.json();
      assert.equal(body.status, 'unsupported');
      assert.equal(body.objective_completed, false);
      assert.equal(body.receipt.evidence, null);
    }
    assert.equal(invoked, 0);
  } finally {
    await new Promise((resolve, reject) => runtime.server.close(error => error ? reject(error) : resolve()));
  }
});

test('mismatched executor operation cannot become a success receipt', async () => {
  const runtime = await startNexusServer({
    host: '127.0.0.1', port: 0,
    automation: { async executeCapability() {
      return { handled: true, operation: 'legal_analysis', verified: true, objective_completed: true,
        summary: { manifest_id: 'bogus', inventory_complete: true }, artifacts: { manifest: '/tmp/manifest' } };
    } },
  });
  try {
    const response = await dispatch(envelope({
      worker: 'automation-orchestrator', capability: 'inventoryWorkspace',
      task_id: 'task-fake', idempotency_key: 'idem-fake',
    }), runtime.url);
    assert.equal(response.status, 500);
    assert.equal((await response.json()).success, false);
  } finally {
    await new Promise((resolve, reject) => runtime.server.close(error => error ? reject(error) : resolve()));
  }
});
