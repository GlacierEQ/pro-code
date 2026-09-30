import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const MAX_BODY_BYTES = 1_000_000;
const MAX_RECEIPTS = 500;

export const WORKER_CAPABILITIES = Object.freeze({
  strategist: ['analyzeStrategy', 'createStrategyTask', 'strategyReviewSync'],
  coordinator: ['assignTask', 'executeTask', 'taskQueueStatusSync'],
  analyst: ['analyzeData', 'synthesizeData', 'dataIngestionSync'],
  creator: ['generateContent', 'generateReport', 'contentSync'],
  'database-crawler': ['consolidatePages', 'crawlDatabase', 'pageSync'],
  'memory-specialist': ['organizeMemory', 'extractMemory', 'memorySync'],
  'python-executor': ['executePython', 'connectNotionAI', 'pythonScriptSync'],
  'api-manager': ['executeAPI', 'configureRateLimiter', 'apiCallSync'],
  'mcp-manager': ['connectMCP', 'manageMCPSession', 'mcpSync'],
  'photo-analyzer': ['analyzePhoto', 'processBatchPhotos', 'photoSync'],
  'video-processor': ['processVideo', 'processBatchVideos', 'videoSync'],
  'case-analyzer': ['analyzeCase', 'consolidateCases', 'caseSync'],
  'motion-generator': ['generateMotion', 'generateBatchMotions', 'motionSync'],
  'ai-executor': ['executeLocalModel', 'handoffFromGemini', 'automationDispatch', 'modelMaximize'],
  'automation-orchestrator': ['runApexMaximize', 'dispatchWorker', 'helixAutomation', 'notionSync'],
});

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function commonHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, X-Case-Id, X-Trace-Id');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Cache-Control', 'no-store');
}

function sendJson(response, statusCode, payload, headers = {}) {
  commonHeaders(response);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function validateDispatch(routeWorker, envelope, headers) {
  if (!isRecord(envelope)) return ['Dispatch envelope must be an object'];
  const errors = [];
  if (envelope.schema_version !== '1.0.0') errors.push('schema_version must be 1.0.0');
  for (const field of ['case_id', 'trace_id', 'task_id', 'idempotency_key', 'worker', 'capability', 'created_at']) {
    if (!nonEmpty(envelope[field])) errors.push(`${field} is required`);
  }
  if (envelope.worker !== routeWorker) errors.push('Route worker does not match envelope.worker');
  const capabilities = WORKER_CAPABILITIES[routeWorker];
  if (!capabilities) errors.push(`Unknown worker: ${routeWorker}`);
  else if (!capabilities.includes(envelope.capability)) errors.push(`${routeWorker} does not own capability ${String(envelope.capability)}`);
  if (!isRecord(envelope.params)) errors.push('params must be an object');
  if (!isRecord(envelope.constraints)) errors.push('constraints must be an object');
  else {
    if (envelope.constraints.human_review_required !== true) errors.push('human_review_required must be true');
    if (envelope.constraints.external_actions !== 'forbidden') errors.push('external_actions must be forbidden');
    if (!Number.isFinite(envelope.constraints.max_runtime_ms) || envelope.constraints.max_runtime_ms <= 0) errors.push('max_runtime_ms must be positive');
    if (!Array.isArray(envelope.constraints.allowed_tools)) errors.push('allowed_tools must be an array');
    if (!Array.isArray(envelope.constraints.source_refs)) errors.push('source_refs must be an array');
  }
  if (headers['x-case-id'] !== envelope.case_id) errors.push('X-Case-Id must match envelope.case_id');
  if (headers['x-trace-id'] !== envelope.trace_id) errors.push('X-Trace-Id must match envelope.trace_id');
  if (headers['idempotency-key'] !== envelope.idempotency_key) errors.push('Idempotency-Key must match envelope.idempotency_key');
  return errors;
}

async function buildResult(envelope, now, automation) {
  const execution = automation
    ? await automation.executeCapability(envelope.capability, envelope.params)
    : { handled: false, summary: null };
  const receipt = {
    receipt_id: `receipt-${envelope.task_id}`,
    schema_version: '1.0.0',
    case_id: envelope.case_id,
    trace_id: envelope.trace_id,
    task_id: envelope.task_id,
    idempotency_key: envelope.idempotency_key,
    worker: envelope.worker,
    capability: envelope.capability,
    status: 'succeeded',
    parameter_count: Object.keys(envelope.params).length,
    automation_handled: execution.handled,
    completed_at: now().toISOString(),
  };
  const result = execution.handled
    ? `${envelope.capability} refreshed workspace intelligence for ${envelope.case_id}; manifest ${execution.summary?.manifest_id ?? 'pending'}. Receipt ${receipt.receipt_id}.`
    : `${envelope.capability} accepted by ${envelope.worker} for ${envelope.case_id}; no local automation handler is registered. Receipt ${receipt.receipt_id}.`;
  return { status: 'succeeded', success: true, result, receipt, automation: execution };
}

function memoryDirectory(target, env) {
  const raw = target === 'aspen' ? env.PRO_CODE_ASPEN_DIR : target === 'gemini' ? env.PRO_CODE_GEMINI_DIR : null;
  return raw ? path.resolve(raw) : null;
}

async function persistMemory(target, entries, env, now) {
  const directory = memoryDirectory(target, env);
  if (!directory) return { status: 'unsupported', target, reason: `PRO_CODE_${target.toUpperCase()}_DIR is not configured` };
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, 'pro-code-memory.json');
  const temporary = `${destination}.${process.pid}.tmp`;
  const snapshot = { schema_version: '1.0.0', source: 'pro-code', target, synced_at: now().toISOString(), entries };
  const content = `${JSON.stringify(snapshot, null, 2)}\n`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, destination);
  return {
    status: 'completed', target, path: destination, records_confirmed: entries.length,
    content_digest: createHash('sha256').update(content).digest('hex'), completed_at: snapshot.synced_at,
  };
}

async function serveStatic(requestPath, response) {
  const relativePath = requestPath === '/' ? 'index.html' : decodeURIComponent(requestPath.replace(/^\/+/, ''));
  const candidate = path.resolve(DIST, relativePath);
  if (!candidate.startsWith(`${DIST}${path.sep}`) && candidate !== path.join(DIST, 'index.html')) return false;
  let filePath = candidate;
  try {
    if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    filePath = path.join(DIST, 'index.html');
  }
  try {
    if (!(await stat(filePath)).isFile()) return false;
    commonHeaders(response);
    response.statusCode = 200;
    response.setHeader('Content-Type', CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream');
    createReadStream(filePath).pipe(response);
    return true;
  } catch {
    return false;
  }
}

export function createNexusHandler({ env = process.env, now = () => new Date(), automation = null } = {}) {
  const idempotency = new Map();
  const receipts = [];
  const contexts = new Map();

  return async function nexusHandler(request, response) {
    commonHeaders(response);
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        const workers = Object.keys(WORKER_CAPABILITIES);
        sendJson(response, 200, {
          status: 'ok', service: 'pro-code-local-nexus', version: '1.1.0', workers,
          runtime: { status: 'ok', workers }, automation: automation?.getStatus() ?? null,
          checkedAt: now().toISOString(),
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/runtime/receipts') {
        sendJson(response, 200, { status: 'ok', receipts: [...receipts] });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/automation/status') {
        sendJson(response, automation ? 200 : 501, automation
          ? { status: 'ok', automation: automation.getStatus() }
          : { status: 'unsupported', error: 'Automation is not attached to this runtime' });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/automation/run') {
        if (!automation) {
          sendJson(response, 501, { status: 'unsupported', error: 'Automation is not attached to this runtime' });
          return;
        }
        const body = await readJson(request);
        const status = await automation.run(nonEmpty(body.reason) ? body.reason : 'api');
        sendJson(response, 200, { status: 'succeeded', success: true, automation: status });
        return;
      }

      const executeMatch = url.pathname.match(/^\/api\/v1\/workers\/([^/]+)\/execute$/);
      if (request.method === 'POST' && executeMatch) {
        const routeWorker = decodeURIComponent(executeMatch[1]);
        const envelope = await readJson(request);
        const errors = validateDispatch(routeWorker, envelope, request.headers);
        if (errors.length) {
          sendJson(response, 422, { status: 'rejected', success: false, error: errors.join('; ') });
          return;
        }
        const key = envelope.idempotency_key;
        const envelopeDigest = digest(envelope);
        const existing = idempotency.get(key);
        if (existing) {
          if (existing.envelopeDigest !== envelopeDigest) {
            sendJson(response, 409, { status: 'rejected', success: false, error: 'Idempotency key was already used with a different envelope' });
            return;
          }
          sendJson(response, 200, existing.payload, { 'X-Idempotent-Replay': 'true' });
          return;
        }
        const payload = await buildResult(envelope, now, automation);
        idempotency.set(key, { envelopeDigest, payload });
        receipts.unshift(payload.receipt);
        if (receipts.length > MAX_RECEIPTS) receipts.length = MAX_RECEIPTS;
        sendJson(response, 200, payload);
        return;
      }

      const contextMatch = url.pathname.match(/^\/context\/([^/]+)$/);
      if (request.method === 'POST' && contextMatch) {
        const sessionId = decodeURIComponent(contextMatch[1]);
        const body = await readJson(request);
        if (!isRecord(body.data)) {
          sendJson(response, 422, { status: 'rejected', error: 'data must be an object' });
          return;
        }
        contexts.set(sessionId, { ...(contexts.get(sessionId) ?? {}), ...body.data });
        sendJson(response, 200, { status: 'succeeded', success: true, session_id: sessionId });
        return;
      }
      if (request.method === 'GET' && contextMatch) {
        const sessionId = decodeURIComponent(contextMatch[1]);
        sendJson(response, 200, { status: 'ok', session_id: sessionId, data: contexts.get(sessionId) ?? {} });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/memory/sync') {
        const body = await readJson(request);
        if (!isRecord(body) || !['aspen', 'gemini'].includes(body.target) || !Array.isArray(body.entries)) {
          sendJson(response, 422, { status: 'rejected', error: 'target must be aspen or gemini and entries must be an array' });
          return;
        }
        const result = await persistMemory(body.target, body.entries, env, now);
        sendJson(response, result.status === 'completed' ? 200 : 501, result);
        return;
      }
      if (request.method === 'GET' && await serveStatic(url.pathname, response)) return;
      sendJson(response, 404, { status: 'not_found', error: `No route for ${request.method} ${url.pathname}` });
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      sendJson(response, statusCode, { status: 'failed', success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export async function startNexusServer({
  host = process.env.PRO_CODE_HOST ?? '127.0.0.1',
  port = Number(process.env.PRO_CODE_PORT ?? 8787),
  env = process.env,
  now,
  automation = null,
} = {}) {
  const server = http.createServer(createNexusHandler({ env, now, automation }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Nexus server did not expose a TCP address');
  return { server, url: `http://${host}:${address.port}` };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const { url } = await startNexusServer();
  console.log(`[pro-code] bare Nexus listening at ${url}`);
}
