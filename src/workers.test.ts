import { describe, expect, it, vi } from 'vitest';
import { NOTION_WORKER_COUNT, WorkersManager } from './workers';

function okResponse(result = 'done'): Response {
  return new Response(JSON.stringify({ status: 'succeeded', result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('WorkersManager dispatch contract', () => {
  it('derives the worker count from the registry', () => {
    expect(NOTION_WORKER_COUNT).toBe(15);
  });

  it('rejects a dispatch without case context before calling the network', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const manager = new WorkersManager({ fetchImpl, baseUrl: 'https://nexus.example' });

    const result = await manager.execute('analyzeCase');

    expect(result).toMatchObject({ status: 'rejected', success: false, live: false });
    expect(result.error?.code).toBe('case_context_required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends a case-scoped idempotent envelope with fail-closed constraints', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    const manager = new WorkersManager({
      fetchImpl,
      baseUrl: 'https://nexus.example/',
      now: () => new Date('2026-07-14T12:00:00.000Z'),
      idFactory: prefix => `${prefix}-generated`,
    });

    const result = await manager.execute('analyzeCase', { source: 'exhibit-1' }, {
      caseId: 'CASE-1FDV-23-0001009',
      taskId: 'task-123',
      traceId: 'trace-456',
      idempotencyKey: 'idem-789',
      priority: 'high',
      allowedTools: ['casebrain:recall'],
      sourceRefs: ['sha256:abc'],
    });

    expect(result).toMatchObject({ status: 'succeeded', success: true, live: true, result: 'done' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://nexus.example/api/v1/workers/case-analyzer/execute');
    expect(init?.headers).toMatchObject({
      'Idempotency-Key': 'idem-789',
      'X-Case-Id': 'CASE-1FDV-23-0001009',
      'X-Trace-Id': 'trace-456',
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      schema_version: '1.0.0',
      case_id: 'CASE-1FDV-23-0001009',
      trace_id: 'trace-456',
      task_id: 'task-123',
      idempotency_key: 'idem-789',
      priority: 'high',
      producer: { system: 'pro-code', component: 'workers-manager', version: '1.0.0' },
      constraints: {
        human_review_required: true,
        external_actions: 'forbidden',
        allowed_tools: ['casebrain:recall'],
        source_refs: ['sha256:abc'],
      },
    });
  });

  it('applies auth and detached-signature hooks without embedding credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    const authHook = vi.fn().mockResolvedValue({
      headers: { Authorization: 'Bearer transport-only' },
      auth: { scheme: 'bearer', key_id: 'key-1' },
      signature: { algorithm: 'Ed25519', key_id: 'key-1', value: 'signature', signed_at: '2026-07-14T12:00:00Z' },
    });
    const manager = new WorkersManager({ fetchImpl, baseUrl: '', caseId: 'CASE-1', authHook });

    const result = await manager.execute('analyzeCase');
    const [, init] = fetchImpl.mock.calls[0];
    const envelope = JSON.parse(String(init?.body));

    expect(result.success).toBe(true);
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer transport-only' });
    expect(envelope.auth).toEqual({ scheme: 'bearer', key_id: 'key-1' });
    expect(envelope.signature).toMatchObject({ algorithm: 'Ed25519', key_id: 'key-1' });
    expect(JSON.stringify(envelope)).not.toContain('transport-only');
  });

  it('does not treat a transport fallback as success', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    const manager = new WorkersManager({ fetchImpl, baseUrl: '', caseId: 'CASE-1' });

    const result = await manager.execute('analyzeCase');

    expect(result).toMatchObject({ status: 'failed', success: false, live: false });
    expect(result.result).toBeUndefined();
    expect(result.error).toMatchObject({ code: 'transport_failed', message: 'offline' });
    expect(manager.findWorkerByName('case-analyzer')).toMatchObject({ status: 'error', lastError: 'offline' });
  });

  it('rejects ambiguous 2xx responses that do not explicitly acknowledge success', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ result: 'maybe done' }), { status: 200 }),
    );
    const manager = new WorkersManager({ fetchImpl, baseUrl: '', caseId: 'CASE-1' });

    const result = await manager.execute('analyzeCase');

    expect(result).toMatchObject({ status: 'failed', success: false, live: false });
    expect(result.error?.code).toBe('invalid_response');
  });

  it('rejects unknown capabilities without passthrough', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const manager = new WorkersManager({ fetchImpl, baseUrl: '', caseId: 'CASE-1' });

    const result = await manager.execute('fileCourtMotion');

    expect(result).toMatchObject({ status: 'rejected', success: false, live: false });
    expect(result.error?.code).toBe('unknown_capability');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
