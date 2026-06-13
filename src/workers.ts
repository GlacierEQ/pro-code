/**
 * Notion Workers Integration for Pro-Code
 * Wired to Nexus API — execute() POSTs to the live endpoint.
 */

const NEXUS_BASE = `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8002`;

export interface WorkerConfig {
  id: string;
  name: string;
  capabilities: string[];
  status: 'deployed' | 'running' | 'paused' | 'error';
  lastRun?: string;
  runsCount: number;
}

export const NOTION_WORKERS: WorkerConfig[] = [
  { id: '019eadea-0000', name: 'strategist',       capabilities: ['analyzeStrategy', 'createStrategyTask', 'strategyReviewSync'],   status: 'deployed', runsCount: 0 },
  { id: '019eadeb-0000', name: 'coordinator',      capabilities: ['assignTask', 'executeTask', 'taskQueueStatusSync'],               status: 'deployed', runsCount: 0 },
  { id: '019eadec-0000', name: 'analyst',          capabilities: ['analyzeData', 'synthesizeData', 'dataIngestionSync'],             status: 'deployed', runsCount: 0 },
  { id: '019eadec-b4de', name: 'creator',          capabilities: ['generateContent', 'generateReport', 'contentSync'],               status: 'deployed', runsCount: 0 },
  { id: '019eae18-0000', name: 'database-crawler', capabilities: ['consolidatePages', 'crawlDatabase', 'pageSync'],                  status: 'deployed', runsCount: 0 },
  { id: '019eae19-0000', name: 'memory-specialist',capabilities: ['organizeMemory', 'extractMemory', 'memorySync'],                  status: 'deployed', runsCount: 0 },
  { id: '019eae19-bc2e', name: 'python-executor',  capabilities: ['executePython', 'connectNotionAI', 'pythonScriptSync'],          status: 'deployed', runsCount: 0 },
  { id: '019eae1a-0000', name: 'api-manager',      capabilities: ['executeAPI', 'configureRateLimiter', 'apiCallSync'],              status: 'deployed', runsCount: 0 },
  { id: '019eae1a-d1ff', name: 'mcp-manager',      capabilities: ['connectMCP', 'manageMCPSession', 'mcpSync'],                     status: 'deployed', runsCount: 0 },
  { id: '019eae1b-0000', name: 'photo-analyzer',   capabilities: ['analyzePhoto', 'processBatchPhotos', 'photoSync'],               status: 'deployed', runsCount: 0 },
  { id: '019eae1b-de64', name: 'video-processor',  capabilities: ['processVideo', 'processBatchVideos', 'videoSync'],               status: 'deployed', runsCount: 0 },
  { id: '019eae1c-0000', name: 'case-analyzer',    capabilities: ['analyzeCase', 'consolidateCases', 'caseSync'],                   status: 'deployed', runsCount: 0 },
  { id: '019eae1c-e35f', name: 'motion-generator', capabilities: ['generateMotion', 'generateBatchMotions', 'motionSync'],          status: 'deployed', runsCount: 0 },
];

export class WorkersManager {
  private workers: Map<string, WorkerConfig> = new Map();

  constructor() {
    NOTION_WORKERS.forEach(w => this.workers.set(w.id, { ...w }));
  }

  /**
   * Execute a capability by POSTing to the live Nexus API.
   * Falls back to a local mock result if the Nexus is unreachable.
   */
  async execute(
    capability: string,
    params?: Record<string, unknown>,
  ): Promise<{ worker: string; result: string }> {
    const worker = this.findWorkerForCapability(capability);
    if (!worker) {
      // capability may be a direct nexus key (e.g. 'omniCrawl') — treat as passthrough
      return { worker: 'nexus', result: `Passthrough capability: ${capability}` };
    }

    worker.status = 'running';
    worker.lastRun = new Date().toISOString();
    worker.runsCount += 1;

    try {
      const endpoint = `${NEXUS_BASE}/api/v1/workers/${worker.name}/execute`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability, params }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { result?: string };
      const result = data.result ?? `${capability} executed on ${worker.name}`;
      worker.status = 'deployed';
      return { worker: worker.name, result };
    } catch (err) {
      // Nexus unreachable — degrade gracefully, don't error-state the worker
      worker.status = 'deployed';
      const errMsg = err instanceof Error ? err.message : String(err);
      return { worker: worker.name, result: `[local fallback] ${capability}: ${errMsg}` };
    }
  }

  findWorkerForCapability(capability: string): WorkerConfig | undefined {
    return Array.from(this.workers.values()).find(w => w.capabilities.includes(capability));
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

  getStats(): { total: number; deployed: number; running: number; paused: number; error: number; totalRuns: number } {
    const workers = Array.from(this.workers.values());
    return {
      total:      workers.length,
      deployed:   workers.filter(w => w.status === 'deployed').length,
      running:    workers.filter(w => w.status === 'running').length,
      paused:     workers.filter(w => w.status === 'paused').length,
      error:      workers.filter(w => w.status === 'error').length,
      totalRuns:  workers.reduce((sum, w) => sum + w.runsCount, 0),
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
