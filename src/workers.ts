/**
 * Notion Workers Integration for Pro-Code
 * Wired to Nexus API (:8002) → apex-workers-runtime (:8003)
 *
 * Flow: pro-code UI → WorkersManager.execute()
 *         → POST nexus-api :8002/api/v1/workers/:name/execute
 *         → nexus-api proxies → apex-workers-runtime :8003/workers/:name/execute
 *         → real capability handler runs
 *         → result bubbles back here
 */

const NEXUS_BASE =
  typeof window !== 'undefined'
    ? `http://${window.location.hostname}:8002`
    : 'http://localhost:8002';

export interface WorkerConfig {
  id: string;
  name: string;
  capabilities: string[];
  status: 'deployed' | 'running' | 'paused' | 'error';
  lastRun?: string;
  runsCount: number;
  lastError?: string;
}

export interface ExecuteResult {
  worker: string;
  capability: string;
  result: string;
  durationMs: number;
  live: boolean; // false = local fallback
}

export interface NexusHealth {
  status: 'ok' | 'unreachable';
  workers?: string[];
  runtimeHealth?: {
    status: 'ok' | 'unreachable';
    workers?: string[];
  };
  checkedAt: string;
}

export const NOTION_WORKERS: WorkerConfig[] = [
  { id: '019eadea-0000', name: 'strategist',        capabilities: ['analyzeStrategy', 'createStrategyTask', 'strategyReviewSync'],  status: 'deployed', runsCount: 0 },
  { id: '019eadeb-0000', name: 'coordinator',       capabilities: ['assignTask', 'executeTask', 'taskQueueStatusSync'],              status: 'deployed', runsCount: 0 },
  { id: '019eadec-0000', name: 'analyst',           capabilities: ['analyzeData', 'synthesizeData', 'dataIngestionSync'],            status: 'deployed', runsCount: 0 },
  { id: '019eadec-b4de', name: 'creator',           capabilities: ['generateContent', 'generateReport', 'contentSync'],              status: 'deployed', runsCount: 0 },
  { id: '019eae18-0000', name: 'database-crawler',  capabilities: ['consolidatePages', 'crawlDatabase', 'pageSync'],                 status: 'deployed', runsCount: 0 },
  { id: '019eae19-0000', name: 'memory-specialist', capabilities: ['organizeMemory', 'extractMemory', 'memorySync'],                 status: 'deployed', runsCount: 0 },
  { id: '019eae19-bc2e', name: 'python-executor',   capabilities: ['executePython', 'connectNotionAI', 'pythonScriptSync'],         status: 'deployed', runsCount: 0 },
  { id: '019eae1a-0000', name: 'api-manager',       capabilities: ['executeAPI', 'configureRateLimiter', 'apiCallSync'],             status: 'deployed', runsCount: 0 },
  { id: '019eae1a-d1ff', name: 'mcp-manager',       capabilities: ['connectMCP', 'manageMCPSession', 'mcpSync'],                    status: 'deployed', runsCount: 0 },
  { id: '019eae1b-0000', name: 'photo-analyzer',    capabilities: ['analyzePhoto', 'processBatchPhotos', 'photoSync'],              status: 'deployed', runsCount: 0 },
  { id: '019eae1b-de64', name: 'video-processor',   capabilities: ['processVideo', 'processBatchVideos', 'videoSync'],              status: 'deployed', runsCount: 0 },
  { id: '019eae1c-0000', name: 'case-analyzer',     capabilities: ['analyzeCase', 'consolidateCases', 'caseSync'],                  status: 'deployed', runsCount: 0 },
  { id: '019eae1c-e35f', name: 'motion-generator',  capabilities: ['generateMotion', 'generateBatchMotions', 'motionSync'],         status: 'deployed', runsCount: 0 },
];

// ─── health check ──────────────────────────────────────────────────────────────

export async function checkNexusHealth(): Promise<NexusHealth> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(`${NEXUS_BASE}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { status: string; runtime?: { status: string; workers?: string[] }; workers?: string[] };
    return {
      status: 'ok',
      workers: data.workers,
      runtimeHealth: data.runtime
        ? { status: data.runtime.status as 'ok' | 'unreachable', workers: data.runtime.workers }
        : undefined,
      checkedAt,
    };
  } catch {
    return { status: 'unreachable', checkedAt };
  }
}

// ─── manager ──────────────────────────────────────────────────────────────────

export class WorkersManager {
  private workers: Map<string, WorkerConfig> = new Map();
  /** true when last health check confirmed nexus-api is live */
  public nexusLive = false;

  constructor() {
    NOTION_WORKERS.forEach(w => this.workers.set(w.id, { ...w }));
  }

  /**
   * Execute a capability by POSTing to the live Nexus API.
   * Returns full ExecuteResult including duration and live flag.
   * Falls back gracefully if Nexus is unreachable.
   */
  async execute(
    capability: string,
    params?: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    const worker = this.findWorkerForCapability(capability);
    const workerName = worker?.name ?? 'nexus';

    if (!worker) {
      return {
        worker: 'nexus',
        capability,
        result: `Passthrough capability: ${capability}`,
        durationMs: 0,
        live: false,
      };
    }

    worker.status = 'running';
    worker.lastRun = new Date().toISOString();
    worker.runsCount += 1;
    worker.lastError = undefined;

    const t0 = performance.now();

    try {
      const endpoint = `${NEXUS_BASE}/api/v1/workers/${worker.name}/execute`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability, params }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${errBody ? ': ' + errBody : ''}`);
      }

      const data = await res.json() as { result?: string; error?: string };
      if (data.error) throw new Error(data.error);

      const result = data.result ?? `${capability} executed on ${worker.name}`;
      worker.status = 'deployed';
      this.nexusLive = true;

      return {
        worker: workerName,
        capability,
        result,
        durationMs: Math.round(performance.now() - t0),
        live: true,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      worker.status = 'error';
      worker.lastError = errMsg;
      // auto-recover status after 30s so UI doesn't stay red forever
      setTimeout(() => {
        const w = this.workers.get(worker.id);
        if (w && w.status === 'error') w.status = 'deployed';
      }, 30_000);

      return {
        worker: workerName,
        capability,
        result: `[fallback] ${errMsg}`,
        durationMs: Math.round(performance.now() - t0),
        live: false,
      };
    }
  }

  /**
   * Sync runtime worker statuses from the live /health endpoint.
   * Call this on mount and on a polling interval.
   */
  async syncFromRuntime(): Promise<NexusHealth> {
    const health = await checkNexusHealth();
    this.nexusLive = health.status === 'ok';

    if (health.status === 'ok' && health.runtimeHealth?.workers) {
      // Mark any worker the runtime reports as available → deployed
      // Workers NOT in the runtime list stay at their current status
      const liveSet = new Set(health.runtimeHealth.workers);
      this.workers.forEach(w => {
        if (liveSet.has(w.name) && w.status !== 'running') {
          w.status = 'deployed';
        }
      });
    }

    return health;
  }

  // ── query helpers ─────────────────────────────────────────────────────────

  findWorkerForCapability(capability: string): WorkerConfig | undefined {
    return Array.from(this.workers.values()).find(w =>
      w.capabilities.includes(capability),
    );
  }

  findWorkerByName(name: string): WorkerConfig | undefined {
    return Array.from(this.workers.values()).find(w => w.name === name);
  }

  getStatus(): WorkerConfig[] {
    return Array.from(this.workers.values());
  }

  getRunningWorkers(): WorkerConfig[] {
    return Array.from(this.workers.values()).filter(w => w.status === 'running');
  }

  getStats() {
    const workers = Array.from(this.workers.values());
    return {
      total:     workers.length,
      deployed:  workers.filter(w => w.status === 'deployed').length,
      running:   workers.filter(w => w.status === 'running').length,
      paused:    workers.filter(w => w.status === 'paused').length,
      error:     workers.filter(w => w.status === 'error').length,
      totalRuns: workers.reduce((sum, w) => sum + w.runsCount, 0),
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
    return true;
  }
}

export const workersManager = new WorkersManager();
