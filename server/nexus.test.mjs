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

async function dispatch(body) {
  return fetch(`${baseUrl}/api/v1/workers/${body.worker}/execute`, {
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

test('dispatch validates and executes a case-scoped capability', async () => {
  const response = await dispatch(envelope());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'succeeded');
  assert.equal(body.success, true);
  assert.equal(body.receipt.case_id, 'CASE-TEST-1');
  assert.equal(body.receipt.capability, 'analyzeCase');
  assert.match(body.result, /Receipt receipt-task-1/);
});

test('identical idempotent replay returns the original receipt', async () => {
  const body = envelope({ task_id: 'task-replay', idempotency_key: 'idem-replay' });
  const first = await dispatch(body);
  const second = await dispatch(body);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('x-idempotent-replay'), 'true');
  assert.deepEqual(await second.json(), await first.json());
});

test('idempotency key reuse with a different envelope fails closed', async () => {
  const first = envelope({ task_id: 'task-conflict-1', idempotency_key: 'idem-conflict' });
  const second = envelope({ task_id: 'task-conflict-2', idempotency_key: 'idem-conflict' });
  assert.equal((await dispatch(first)).status, 200);
  const response = await dispatch(second);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.match(body.error, /different envelope/);
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
