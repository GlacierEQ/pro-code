/**
 * Browser-local memory for Pro-Code.
 *
 * Local state is persisted immediately. The optional local Nexus runtime accepts
 * context updates and can atomically synchronize snapshots to explicitly
 * configured Aspen Grove or Gemini directories.
 */

export interface MemoryEntry {
  id: string;
  content: string;
  category: 'short-term' | 'long-term' | 'episodic';
  priority: 'low' | 'medium' | 'high';
  timestamp: string;
}

export type MemorySyncTarget = 'aspen' | 'gemini';

export type MemorySyncResult =
  | {
      status: 'completed';
      target: MemorySyncTarget;
      path: string;
      records_confirmed: number;
      content_digest: string;
      completed_at: string;
    }
  | {
      status: 'unsupported' | 'failed' | 'rejected';
      target?: MemorySyncTarget;
      reason?: string;
      error?: string;
    };

function runtimeBaseUrl(): string {
  const configured = import.meta.env.VITE_NEXUS_BASE_URL?.trim();
  return (configured || 'http://127.0.0.1:8787').replace(/\/+$/, '');
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<MemoryEntry>;
  return typeof entry.id === 'string'
    && typeof entry.content === 'string'
    && ['short-term', 'long-term', 'episodic'].includes(String(entry.category))
    && ['low', 'medium', 'high'].includes(String(entry.priority))
    && typeof entry.timestamp === 'string';
}

export class MemorySystem {
  private cache: Map<string, MemoryEntry> = new Map();
  private readonly sessionId: string;

  constructor() {
    this.sessionId = `procode-${Date.now()}`;
    this.loadFromStorage();
  }

  async store(
    id: string,
    content: string,
    category: MemoryEntry['category'] = 'short-term',
    priority: MemoryEntry['priority'] = 'medium',
  ): Promise<void> {
    const entry: MemoryEntry = {
      id,
      content,
      category,
      priority,
      timestamp: new Date().toISOString(),
    };
    this.cache.set(id, entry);
    this.persistToStorage();

    try {
      await fetch(`${runtimeBaseUrl()}/context/${encodeURIComponent(this.sessionId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { [id]: entry } }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      // The browser-local write is already complete. Remote context is optional.
    }
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    return this.cache.get(id);
  }

  async getAll(): Promise<MemoryEntry[]> {
    return Array.from(this.cache.values());
  }

  async getByCategory(category: MemoryEntry['category']): Promise<MemoryEntry[]> {
    return Array.from(this.cache.values()).filter(entry => entry.category === category);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = this.cache.delete(id);
    this.persistToStorage();
    return deleted;
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.persistToStorage();
  }

  async getStats(): Promise<{
    total: number;
    byCategory: Record<string, number>;
    byPriority: Record<string, number>;
  }> {
    const entries = Array.from(this.cache.values());
    const byCategory: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const entry of entries) {
      byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
      byPriority[entry.priority] = (byPriority[entry.priority] ?? 0) + 1;
    }
    return { total: entries.length, byCategory, byPriority };
  }

  async syncWithAspenGroves(): Promise<MemorySyncResult> {
    return this.sync('aspen');
  }

  async syncWithGemini(): Promise<MemorySyncResult> {
    return this.sync('gemini');
  }

  private async sync(target: MemorySyncTarget): Promise<MemorySyncResult> {
    try {
      const response = await fetch(`${runtimeBaseUrl()}/api/v1/memory/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, entries: Array.from(this.cache.values()) }),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json().catch(() => null) as MemorySyncResult | null;
      if (!payload || typeof payload.status !== 'string') {
        return { status: 'failed', target, error: 'Runtime returned an invalid synchronization response' };
      }
      if (!response.ok && payload.status === 'completed') {
        return { status: 'failed', target, error: `Runtime returned HTTP ${response.status}` };
      }
      return payload;
    } catch (error) {
      return {
        status: 'failed',
        target,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private persistToStorage(): void {
    try {
      const data = JSON.stringify(Array.from(this.cache.entries()));
      localStorage.setItem('procode-memory', data);
    } catch {
      // localStorage unavailable; retain in-memory state only.
    }
  }

  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem('procode-memory');
      if (!data) return;
      const entries = JSON.parse(data) as unknown;
      if (!Array.isArray(entries)) return;
      for (const item of entries) {
        if (!Array.isArray(item) || item.length !== 2) continue;
        const [key, value] = item;
        if (typeof key === 'string' && isMemoryEntry(value)) this.cache.set(key, value);
      }
    } catch {
      // localStorage unavailable or invalid; start with an empty in-memory cache.
    }
  }
}

export const memory = new MemorySystem();
