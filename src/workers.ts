/**
 * Pro-Code worker dispatch.
 *
 * This module is deliberately fail-closed: every request carries a case-scoped,
 * idempotent dispatch envelope and only an explicit runtime acknowledgement is
 * reported as success. The browser never stores signing secrets; deployments
 * inject an auth/signature hook that can delegate signing to a trusted boundary.
 */

export type WorkerStatus = 'deployed' | 'running' | 'paused' | 'error';
export type DispatchPriority = 'low' | 'normal' | 'high' | 'urgent';
export type DispatchStatus = 'succeeded' | 'failed' | 'rejected';

export interface WorkerConfig {
  id: string;
  name: string;
  capabilities: string[];
  status: WorkerStatus;
  lastRun?: string;
  runsCount: number;
  lastError?: string;
}

export interface DispatchConstraints {
  human_review_required: true;
  external_actions: 'forbidden';
  max_runtime_ms: number;
  allowed_tools: string[];
  source_refs: string[];
}

export interface DispatchProducer {
  system: 'pro-code';
  component: string;
  version: string;
}

export interface DispatchAuthMetadata {
  scheme: string;
  key_id?: string;
  subject?: string;
}

export interface DispatchSignature {
  algorithm: string;
  key_id: string;
  value: string;
  signed_at: string;
}

export interface UnsignedDispatchEnvelope {
  schema_version: '1.0.0';
  case_id: string;
  trace_id: string;
  task_id: string;
  idempotency_key: string;
  priority: DispatchPriority;
  constraints: DispatchConstraints;
  producer: DispatchProducer;
  worker: string;
  capability: string;
  params: Record<string, unknown>;
  created_at: string;
}

export interface DispatchEnvelope extends UnsignedDispatchEnvelope {
  auth?: DispatchAuthMetadata;
  signature?: DispatchSignature;
}

export interface DispatchSecurity {
  /** Transport headers only. Never put bearer tokens in the envelope. */
  headers?: Record<string, string>;
  /** Non-secret authentication metadata recorded with the request. */
  auth?: DispatchAuthMetadata;
  /** Detached signature produced by a trusted signer. */
  signature?: DispatchSignature;
}

export type DispatchAuthHook = (
  envelope: Readonly<UnsignedDispatchEnvelope>,
) => DispatchSecurity | Promise<DispatchSecurity>;

export interface DispatchOptions {
  caseId?: string;
  traceId?: string;
  taskId?: string;
  idempotencyKey?: string;
  priority?: DispatchPriority;
  maxRuntimeMs?: number;
  allowedTools?: string[];
  sourceRefs?: string[];
}

export interface DispatchError {
  code: 'case_context_required' | 'unknown_capability' | 'auth_failed' | 'transport_failed' | 'runtime_rejected' | 'invalid_response';
  message: string;
}

export interface ExecuteResult {
  worker: string;
  capability: string;
  status: DispatchStatus;
  success: boolean;
  result?: string;
  error?: DispatchError;
  durationMs: number;
  live: boolean;
  envelope?: DispatchEnvelope;
}

export interface NexusHealth {
  status: 'ok' | 'unreachable';
  workers?: string[];
  runtimeHealth?: { status: 'ok' | 'unreachable'; workers?: string[] };
  checkedAt: string;
}

export interface WorkersManagerOptions {
  baseUrl?: string;
  caseId?: string;
  fetchImpl?: typeof fetch;
  authHook?: DispatchAuthHook;
  now?: () => Date;
  idFactory?: (prefix: 'trace' | 'task') => string;
  producer?: DispatchProducer;
  timeoutMs?: number;
}

interface RuntimeResponse {
  status?: string;
  success?: boolean;
  result?: string;
  error?: string;
}

function readEnv(name: string): string | undefined {
  const value = import.meta.env?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getNexusBaseUrl(): string {
  return (readEnv('VITE_NEXUS_BASE_URL') ?? '').replace(/\/+$/, '');
}

function createId(prefix: 'trace' | 'task'): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

function transportError(error: unknown): DispatchError {
  return {
    code: 'transport_failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

export const NOTION_WORKERS: WorkerConfig[] = [
  { id: '019eadea-0000', name: 'strategist', capabilities: ['analyzeStrategy', 'createStrategyTask', 'strategyReviewSync'], status: 'deployed', runsCount: 0 },
  { id: '019eadeb-0000', name: 'coordinator', capabilities: ['assignTask', 'executeTask', 'taskQueueStatusSync'], status: 'deployed', runsCount: 0 },
  { id: '019eadec-0000', name: 'analyst', capabilities: ['analyzeData', 'synthesizeData', 'dataIngestionSync'], status: 'deployed', runsCount: 0 },
  { id: '019eadec-b4de', name: 'creator', capabilities: ['generateContent', 'generateReport', 'contentSync'], status: 'deployed', runsCount: 0 },
  { id: '019eae18-0000', name: 'database-crawler', capabilities: ['consolidatePages', 'crawlDatabase', 'pageSync'], status: 'deployed', runsCount: 0 },
  { id: '019eae19-0000', name: 'memory-specialist', capabilities: ['organizeMemory', 'extractMemory', 'memorySync'], status: 'deployed', runsCount: 0 },
  { id: '019eae19-bc2e', name: 'python-executor', capabilities: ['executePython', 'connectNotionAI', 'pythonScriptSync'], status: 'deployed', runsCount: 0 },
  { id: '019eae1a-0000', name: 'api-manager', capabilities: ['executeAPI', 'configureRateLimiter', 'apiCallSync'], status: 'deployed', runsCount: 0 },
  { id: '019eae1a-d1ff', name: 'mcp-manager', capabilities: ['connectMCP', 'manageMCPSession', 'mcpSync'], status: 'deployed', runsCount: 0 },
  { id: '019eae1b-0000', name: 'photo-analyzer', capabilities: ['analyzePhoto', 'processBatchPhotos', 'photoSync'], status: 'deployed', runsCount: 0 },
  { id: '019eae1b-de64', name: 'video-processor', capabilities: ['processVideo', 'processBatchVideos', 'videoSync'], status: 'deployed', runsCount: 0 },
  { id: '019eae1c-0000', name: 'case-analyzer', capabilities: ['analyzeCase', 'consolidateCases', 'caseSync'], status: 'deployed', runsCount: 0 },
  { id: '019eae1c-e35f', name: 'motion-generator', capabilities: ['generateMotion', 'generateBatchMotions', 'motionSync'], status: 'deployed', runsCount: 0 },
  { id: '019eae1d-0000', name: 'ai-executor', capabilities: ['executeLocalModel', 'handoffFromGemini', 'automationDispatch', 'modelMaximize'], status: 'deployed', runsCount: 0 },
  { id: '019eae1d-a1b2', name: 'automation-orchestrator', capabilities: ['runApexMaximize', 'dispatchWorker', 'helixAutomation', 'notionSync'], status: 'deployed', runsCount: 0 },
];

export const NOTION_WORKER_COUNT = NOTION_WORKERS.length;

export async function checkNexusHealth(
  baseUrl = getNexusBaseUrl(),
  fetchImpl: typeof fetch = fetch,
): Promise<NexusHealth> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetchImpl(`${baseUrl}/health`, { signal: timeoutSignal(5_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { status?: string; runtime?: { status?: string; workers?: string[] }; workers?: string[] };
    if (data.status !== 'ok') throw new Error('Nexus health response was not ok');
    return {
      status: 'ok',
      workers: data.workers,
      runtimeHealth: data.runtime
        ? { status: data.runtime.status === 'ok' ? 'ok' : 'unreachable', workers: data.runtime.workers }
        : undefined,
      checkedAt,
    };
  } catch {
    return { status: 'unreachable', checkedAt };
  }
}

export class WorkersManager {
  private workers: Map<string, WorkerConfig> = new Map();
  private readonly baseUrl: string;
  private readonly configuredCaseId?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly authHook?: DispatchAuthHook;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: 'trace' | 'task') => string;
  private readonly producer: DispatchProducer;
  private readonly timeoutMs: number;
  public nexusLive = false;

  constructor(options: WorkersManagerOptions = {}) {
    NOTION_WORKERS.forEach(worker => this.workers.set(worker.id, { ...worker, capabilities: [...worker.capabilities] }));
    this.baseUrl = (options.baseUrl ?? getNexusBaseUrl()).replace(/\/+$/, '');
    this.configuredCaseId = options.caseId?.trim() || readEnv('VITE_CASE_ID');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.authHook = options.authHook;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? createId;
    this.producer = options.producer ?? { system: 'pro-code', component: 'workers-manager', version: '1.0.0' };
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async execute(
    capability: string,
    params: Record<string, unknown> = {},
    options: DispatchOptions = {},
  ): Promise<ExecuteResult> {
    const startedAt = performance.now();
    const worker = this.findWorkerForCapability(capability);
    if (!worker) {
      return this.reject('nexus', capability, 'unknown_capability', `No registered worker owns ${capability}`, startedAt);
    }

    const caseId = options.caseId?.trim() || this.configuredCaseId;
    if (!caseId) {
      return this.reject(worker.name, capability, 'case_context_required', 'Dispatch requires an explicit case_id', startedAt);
    }

    const taskId = options.taskId ?? this.idFactory('task');
    const unsigned: UnsignedDispatchEnvelope = {
      schema_version: '1.0.0',
      case_id: caseId,
      trace_id: options.traceId ?? this.idFactory('trace'),
      task_id: taskId,
      idempotency_key: options.idempotencyKey ?? `pro-code:${caseId}:${taskId}`,
      priority: options.priority ?? 'normal',
      constraints: {
        human_review_required: true,
        external_actions: 'forbidden',
        max_runtime_ms: options.maxRuntimeMs ?? this.timeoutMs,
        allowed_tools: [...(options.allowedTools ?? [])],
        source_refs: [...(options.sourceRefs ?? [])],
      },
      producer: { ...this.producer },
      worker: worker.name,
      capability,
      params,
      created_at: this.now().toISOString(),
    };

    let security: DispatchSecurity = {};
    try {
      security = this.authHook ? await this.authHook(unsigned) : {};
    } catch (error) {
      return this.reject(
        worker.name,
        capability,
        'auth_failed',
        error instanceof Error ? error.message : String(error),
        startedAt,
      );
    }

    const envelope: DispatchEnvelope = { ...unsigned, auth: security.auth, signature: security.signature };
    worker.status = 'running';
    worker.lastRun = unsigned.created_at;
    worker.runsCount += 1;
    worker.lastError = undefined;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/workers/${worker.name}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': envelope.idempotency_key,
          'X-Case-Id': envelope.case_id,
          'X-Trace-Id': envelope.trace_id,
          ...security.headers,
        },
        body: JSON.stringify(envelope),
        signal: timeoutSignal(envelope.constraints.max_runtime_ms),
      });

      const body = await response.json().catch(() => null) as RuntimeResponse | null;
      if (!response.ok) {
        throw { kind: 'runtime', message: body?.error ?? `HTTP ${response.status}` };
      }
      if (!body || body.error) {
        throw { kind: 'runtime', message: body?.error ?? 'Runtime returned no JSON acknowledgement' };
      }
      if (body.status !== 'succeeded' && body.success !== true) {
        throw { kind: 'invalid', message: 'Runtime response did not explicitly acknowledge success' };
      }
      if (typeof body.result !== 'string') {
        throw { kind: 'invalid', message: 'Runtime success response omitted a string result' };
      }

      worker.status = 'deployed';
      this.nexusLive = true;
      return {
        worker: worker.name,
        capability,
        status: 'succeeded',
        success: true,
        result: body.result,
        durationMs: elapsedMs(startedAt),
        live: true,
        envelope,
      };
    } catch (error) {
      const typed = error as { kind?: string; message?: string };
      const dispatchError: DispatchError = typed.kind === 'runtime'
        ? { code: 'runtime_rejected', message: typed.message ?? 'Runtime rejected dispatch' }
        : typed.kind === 'invalid'
          ? { code: 'invalid_response', message: typed.message ?? 'Invalid runtime response' }
          : transportError(error);

      worker.status = 'error';
      worker.lastError = dispatchError.message;
      this.nexusLive = false;
      return {
        worker: worker.name,
        capability,
        status: 'failed',
        success: false,
        error: dispatchError,
        durationMs: elapsedMs(startedAt),
        live: false,
        envelope,
      };
    }
  }

  private reject(
    worker: string,
    capability: string,
    code: DispatchError['code'],
    message: string,
    startedAt: number,
  ): ExecuteResult {
    return {
      worker,
      capability,
      status: 'rejected',
      success: false,
      error: { code, message },
      durationMs: elapsedMs(startedAt),
      live: false,
    };
  }

  async syncFromRuntime(): Promise<NexusHealth> {
    const health = await checkNexusHealth(this.baseUrl, this.fetchImpl);
    this.nexusLive = health.status === 'ok';
    if (health.status === 'ok' && health.runtimeHealth?.workers) {
      const liveSet = new Set(health.runtimeHealth.workers);
      this.workers.forEach(worker => {
        if (liveSet.has(worker.name) && worker.status !== 'running') {
          worker.status = 'deployed';
          worker.lastError = undefined;
        }
      });
    }
    return health;
  }

  findWorkerForCapability(capability: string): WorkerConfig | undefined {
    return Array.from(this.workers.values()).find(worker => worker.capabilities.includes(capability));
  }

  findWorkerByName(name: string): WorkerConfig | undefined {
    return Array.from(this.workers.values()).find(worker => worker.name === name);
  }

  getStatus(): WorkerConfig[] { return Array.from(this.workers.values()); }
  getRunningWorkers(): WorkerConfig[] { return this.getStatus().filter(worker => worker.status === 'running'); }

  getStats() {
    const all = this.getStatus();
    return {
      total: all.length,
      deployed: all.filter(worker => worker.status === 'deployed').length,
      running: all.filter(worker => worker.status === 'running').length,
      paused: all.filter(worker => worker.status === 'paused').length,
      error: all.filter(worker => worker.status === 'error').length,
      totalRuns: all.reduce((sum, worker) => sum + worker.runsCount, 0),
      nexusLive: this.nexusLive,
    };
  }

  pauseWorker(name: string): boolean {
    const worker = this.findWorkerByName(name);
    if (!worker) return false;
    worker.status = 'paused';
    return true;
  }

  resumeWorker(name: string): boolean {
    const worker = this.findWorkerByName(name);
    if (!worker) return false;
    worker.status = 'deployed';
    worker.lastError = undefined;
    return true;
  }
}

export const workersManager = new WorkersManager();
