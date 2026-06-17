/**
 * Pro-Code Workers — Notion Workers + QUANTUM-SOVEREIGN mesh
 * GlacierEQ · APEX Runtime · June 2026
 *
 * Flow: pro-code UI → WorkersManager.execute()
 *   → POST nexus-api :8002/api/v1/workers/:name/execute
 *   → nexus-api proxies → apex-workers-runtime :8003/workers/:name/execute
 *   → real capability handler runs → result bubbles back here
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
  live: boolean;
}

export interface NexusHealth {
  status: 'ok' | 'unreachable';
  workers?: string[];
  runtimeHealth?: { status: 'ok' | 'unreachable'; workers?: string[] };
  checkedAt: string;
}

export const NOTION_WORKERS: WorkerConfig[] = [
  // Core intelligence
  { id: '019eadea-0000', name: 'strategist',        capabilities: ['analyzeStrategy', 'createStrategyTask', 'strategyReviewSync'],       status: 'deployed', runsCount: 0 },
  { id: '019eadeb-0000', name: 'coordinator',       capabilities: ['assignTask', 'executeTask', 'taskQueueStatusSync'],                   status: 'deployed', runsCount: 0 },
  { id: '019eadec-0000', name: 'analyst',           capabilities: ['analyzeData', 'synthesizeData', 'dataIngestionSync'],                 status: 'deployed', runsCount: 0 },
  { id: '019eadec-b4de', name: 'creator',           capabilities: ['generateContent', 'generateReport', 'contentSync'],                   status: 'deployed', runsCount: 0 },
  // Data & memory
  { id: '019eae18-0000', name: 'database-crawler',  capabilities: ['consolidatePages', 'crawlDatabase', 'pageSync'],                     status: 'deployed', runsCount: 0 },
  { id: '019eae19-0000', name: 'memory-specialist', capabilities: ['organizeMemory', 'extractMemory', 'memorySync'],                     status: 'deployed', runsCount: 0 },
  // Execution
  { id: '019eae19-bc2e', name: 'python-executor',   capabilities: ['executePython', 'connectNotionAI', 'pythonScriptSync'],              status: 'deployed', runsCount: 0 },
  { id: '019eae1a-0000', name: 'api-manager',       capabilities: ['executeAPI', 'configureRateLimiter', 'apiCallSync'],                  status: 'deployed', runsCount: 0 },
  { id: '019eae1a-d1ff', name: 'mcp-manager',       capabilities: ['connectMCP', 'manageMCPSession', 'mcpSync'],                        status: 'deployed', runsCount: 0 },
  // Media
  { id: '019eae1b-0000', name: 'photo-analyzer',    capabilities: ['analyzePhoto', 'processBatchPhotos', 'photoSync'],                   status: 'deployed', runsCount: 0 },
  { id: '019eae1b-de64', name: 'video-processor',   capabilities: ['processVideo', 'processBatchVideos', 'videoSync'],                   status: 'deployed', runsCount: 0 },
  // Legal / case
  { id: '019eae1c-0000', name: 'case-analyzer',     capabilities: ['analyzeCase', 'consolidateCases', 'caseSync'],                      status: 'deployed', runsCount: 0 },
  { id: '019eae1c-e35f', name: 'motion-generator',  capabilities: ['generateMotion', 'generateBatchMotions', 'motionSync'],              status: 'deployed', runsCount: 0 },
];

// ─── health check ─────────────────────────────────────────────────────────────
export async function checkNexusHealth(): Promise<NexusHealth> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(`${NEXUS_BASE}/health`, { signal: AbortSignal.timeout(5_000) });
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
  public nexusLive = false;

  constructor() {
    NOTION_WORKERS.forEach(w => this.workers.set(w.id, { ...w }));
  }

  /** Execute a named capability → live Nexus API or graceful local fallback */
  async execute(capability: string, params?: Record<string, unknown>): Promise<ExecuteResult> {
    const worker = this.findWorkerForCapability(capability);
    const workerName = worker?.name ?? 'nexus';

    if (!worker) {
      return { worker: 'nexus', capability, result: `Passthrough: ${capability}`, durationMs: 0, live: false };
    }

    worker.status = 'running';
    worker.lastRun = new Date().toISOString();
    worker.runsCount += 1;
    worker.lastError = undefined;

    const t0 = performance.now();

    try {
      const res = await fetch(`${NEXUS_BASE}/api/v1/workers/${worker.name}/execute`, {
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

      worker.status = 'deployed';
      this.nexusLive = true;

      return {
        worker: workerName,
        capability,
        result: data.result ?? `${capability} executed on ${worker.name}`,
        durationMs: Math.round(performance.now() - t0),
        live: true,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      worker.status = 'error';
      worker.lastError = errMsg;
      // Auto-recover status after 30s
      setTimeout(() => {
        const w = this.workers.get(worker.id);
        if (w?.status === 'error') w.status = 'deployed';
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

  /** Sync runtime worker statuses from the live /health endpoint */
  async syncFromRuntime(): Promise<NexusHealth> {
    const health = await checkNexusHealth();
    this.nexusLive = health.status === 'ok';
    if (health.status === 'ok' && health.runtimeHealth?.workers) {
      const liveSet = new Set(health.runtimeHealth.workers);
      this.workers.forEach(w => {
        if (liveSet.has(w.name) && w.status !== 'running') w.status = 'deployed';
      });
    }
    return health;
  }

  findWorkerForCapability(capability: string): WorkerConfig | undefined {
    return Array.from(this.workers.values()).find(w => w.capabilities.includes(capability));
  }

  findWorkerByName(name: string): WorkerConfig | undefined {
    return Array.from(this.workers.values()).find(w => w.name === name);
  }

  getStatus():         WorkerConfig[]  { return Array.from(this.workers.values()); }
  getRunningWorkers(): WorkerConfig[]  { return Array.from(this.workers.values()).filter(w => w.status === 'running'); }

  getStats() {
    const all = Array.from(this.workers.values());
    return {
      total:     all.length,
      deployed:  all.filter(w => w.status === 'deployed').length,
      running:   all.filter(w => w.status === 'running').length,
      paused:    all.filter(w => w.status === 'paused').length,
      error:     all.filter(w => w.status === 'error').length,
      totalRuns: all.reduce((s, w) => s + w.runsCount, 0),
      nexusLive: this.nexusLive,
    };
  }

  pauseWorker(name: string):  boolean { const w = this.findWorkerByName(name); if (!w) return false; w.status = 'paused';   return true; }
  resumeWorker(name: string): boolean { const w = this.findWorkerByName(name); if (!w) return false; w.status = 'deployed'; return true; }
}

export const workersManager = new WorkersManager();
