import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startNexusServer } from '../server/nexus.mjs';
import { createDispatchJournal } from '../server/durable-dispatch.mjs';

// Real local HTTP execution. "Bare" and "durable" use the SAME Nexus source,
// operation fixture, request envelope and runtime; only journalDir differs.
// This is a harness component ablation, not a model benchmark.
const CASES = Object.freeze([
  { id: 'sequential_replay', behavior: 'same-process idempotent replay' },
  { id: 'concurrent_replay', behavior: 'parallel identical requests execute once' },
  { id: 'restart_replay', behavior: 'a completed request is not reexecuted after restart' },
  { id: 'restart_conflict', behavior: 'a reused key with different input rejects after restart' },
  { id: 'uncertain_claim', behavior: 'an interrupted claim cannot be blindly reexecuted' },
  { id: 'unsupported_capability', behavior: 'unsupported work never claims success' },
  { id: 'foreign_origin', behavior: 'cross-origin browser request is rejected' },
]);
const DATASET_ID = createHash('sha256').update(JSON.stringify(CASES)).digest('hex');

function envelope(id, capability = 'inventoryWorkspace') {
  const inventory = capability === 'inventoryWorkspace';
  return {
    schema_version: '1.0.0',
    case_id: inventory ? 'workspace:local' : 'EVAL-CASE',
    trace_id: 'eval-trace-' + id,
    task_id: 'eval-task-' + id,
    idempotency_key: 'eval-idempotency-' + id,
    priority: 'normal',
    constraints: {
      human_review_required: !inventory,
      external_actions: 'forbidden',
      max_runtime_ms: 30000,
      allowed_tools: [],
      source_refs: [],
    },
    producer: { system: 'pro-code', component: 'harness-evaluation', version: '1.0.0' },
    worker: inventory ? 'automation-orchestrator' : 'case-analyzer',
    capability, params: { fixture: id },
    created_at: '2026-11-15T00:00:00.000Z',
  };
}

async function request(url, body) {
  const response = await fetch(url + '/api/v1/workers/' + body.worker + '/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': body.idempotency_key,
      'X-Case-Id': body.case_id,
      'X-Trace-Id': body.trace_id,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, replay: response.headers.get('x-idempotent-replay') === 'true',
    payload: await response.json() };
}
async function stop(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function executeCase(testCase, mode) {
  const root = await mkdtemp(path.join(tmpdir(), 'pro-code-eval-'));
  const journalDir = path.join(root, 'journal');
  const durable = mode === 'durable';
  let executions = 0;
  const automation = {
    async executeCapability(capability) {
      assert.equal(capability, 'inventoryWorkspace');
      executions++;
      return {
        handled: true, operation: 'workspace_inventory', verified: true, objective_completed: true,
        summary: {
          manifest_id: 'sha256-eval-' + testCase.id, inventory_complete: true,
          file_count: 2, hash_complete: true, hash_skipped_files: 0,
        },
        artifacts: { manifest: '/fixture/manifest.json' },
      };
    },
  };
  let running;
  const launch = async () => {
    running = await startNexusServer({ host: '127.0.0.1', port: 0,
      automation, journalDir: durable ? journalDir : null });
  };
  const restart = async () => {
    await stop(running.server);
    running = null;
    await launch();
  };
  const body = envelope(testCase.id);
  const proof = { case_id: testCase.id, expected: testCase.behavior, mode };
  try {
    if (testCase.id === 'uncertain_claim') {
      const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const claim = await createDispatchJournal(journalDir).reserve(body.idempotency_key, digest);
      assert.equal(claim.state, 'reserved');
    }
    await launch();
    if (testCase.id === 'foreign_origin') {
      const response = await fetch(running.url + '/health', { headers: { Origin: 'https://untrusted.example' } });
      proof.status = response.status;
      proof.correct = response.status === 403 && executions === 0
        && response.headers.get('access-control-allow-origin') === null;
    } else if (testCase.id === 'unsupported_capability') {
      const result = await request(running.url, envelope(testCase.id, 'analyzeCase'));
      proof.status = result.status;
      proof.correct = result.status === 501 && result.payload.objective_completed === false
        && result.payload.receipt?.status === 'unsupported' && executions === 0;
    } else if (testCase.id === 'uncertain_claim') {
      const result = await request(running.url, body);
      proof.status = result.status;
      proof.correct = result.status === 409 && result.payload.success === false
        && /reconcile its native outcome/.test(result.payload.error ?? '') && executions === 0;
    } else if (testCase.id === 'concurrent_replay' || testCase.id === 'sequential_replay') {
      let first, again;
      if (testCase.id === 'concurrent_replay') {
        [first, again] = await Promise.all([request(running.url, body), request(running.url, body)]);
      } else {
        first = await request(running.url, body);
        again = await request(running.url, body);
      }
      proof.first_status = first.status;
      proof.replay_status = again.status;
      proof.correct = first.status === 200 && again.status === 200 && executions === 1
        && JSON.stringify(first.payload) === JSON.stringify(again.payload)
        && (first.replay || again.replay);
    } else if (testCase.id === 'restart_replay' || testCase.id === 'restart_conflict') {
      const first = await request(running.url, body);
      await restart();
      const secondBody = testCase.id === 'restart_conflict'
        ? { ...body, params: { fixture: testCase.id, changed: true } }
        : body;
      const second = await request(running.url, secondBody);
      proof.first_status = first.status;
      proof.second_status = second.status;
      proof.replayed = second.replay;
      if (testCase.id === 'restart_replay') {
        proof.correct = first.status === 200 && second.status === 200
          && second.replay && executions === 1
          && JSON.stringify(first.payload) === JSON.stringify(second.payload);
      } else {
        proof.correct = first.status === 200 && second.status === 409 && executions === 1
          && second.payload.success === false;
      }
    } else {
      throw new Error('Unknown evaluation case ' + testCase.id);
    }
    proof.worker_executions = executions;
    return proof;
  } finally {
    if (running) await stop(running.server);
    await rm(root, { recursive: true, force: true });
  }
}

export async function evaluateHarness({ revision = process.env.GITHUB_SHA ?? null } = {}) {
  const baseline = [];
  const candidate = [];
  for (const testCase of CASES) {
    baseline.push(await executeCase(testCase, 'bare'));
    candidate.push(await executeCase(testCase, 'durable'));
  }
  const summary = cases => ({
    passed: cases.filter(x => x.correct).length,
    total: cases.length,
    correctness: Number((cases.filter(x => x.correct).length / cases.length).toFixed(6)),
    worker_executions: cases.reduce((sum, x) => sum + x.worker_executions, 0),
  });
  const before = summary(baseline);
  const after = summary(candidate);
  const verified = after.passed === CASES.length && after.passed > before.passed
    && candidate.every(x => x.correct === true);
  return {
    schema_version: 'glaciereq.pro-code.harness-eval.v1',
    evaluation_kind: 'hermetic_real_http_ablation',
    scope: 'local_fixture_only',
    dataset_sha256: DATASET_ID,
    source_revision: revision,
    environment: { node: process.version, platform: process.platform },
    model: null, model_weights_changed: false,
    compared: {
      baseline: { harness: 'Nexus without durable journal', ...before },
      candidate: { harness: 'Nexus with durable journal', ...after },
      delta_correct_cases: after.passed - before.passed,
    },
    cases: { baseline, candidate },
    result: verified ? 'local_ablation_improvement_verified' : 'not_verified',
    limitations: [
      'Not SWE-bench, Terminal-Bench, an LLM evaluation, or a held-out coding benchmark',
      'Worker operations are deterministic fixtures without external provider side effects',
      'Restart is a controlled server restart; interrupted claims are pre-seeded',
      'No production deployment, overall agent improvement, or cross-provider exactly-once guarantee implied',
    ],
  };
}

async function cli(args) {
  const strict = args.includes('--strict');
  const outIndex = args.indexOf('--out');
  if (outIndex !== -1 && (!args[outIndex + 1] || args[outIndex + 1].startsWith('--'))) {
    throw new Error('--out requires an explicit file path');
  }
  const result = await evaluateHarness();
  const content = JSON.stringify(result, null, 2) + '\n';
  if (outIndex !== -1) {
    const destination = path.resolve(args[outIndex + 1]);
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = destination + '.' + process.pid + '.tmp';
    try {
      await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  process.stdout.write(content);
  if (strict && result.result !== 'local_ablation_improvement_verified') process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (import.meta.url === invokedPath) {
  cli(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
