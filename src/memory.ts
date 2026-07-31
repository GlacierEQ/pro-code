/**
 * Browser-local memory for Pro-Code.
 *
 * The in-memory and localStorage layers are implemented. Optional external
 * synchronization remains explicit and fail-closed because a browser cannot
 * write to operator filesystem paths without a trusted runtime boundary.
 */

export interface MemoryEntry {
  id: string;
  content: string;
  category: 'short-term' | 'long-term' | 'episodic';
  priority: 'low' | 'medium' | 'high';
  timestamp: string;
}

const COMET_AGENT_URL = 'http://localhost:8787';

export class MemorySystem {
  private cache: Map<string, MemoryEntry> = new Map();
  private sessionId: string;

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

    // Best-effort transport only. Local persistence remains authoritative.
    fetch(`${COMET_AGENT_URL}/context/${this.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { [id]: entry } }),
      signal: AbortSignal.timeout(3_000),
    }).catch(() => {
      // comet-agent is optional; failed transport is never converted to success.
    });
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    return this.cache.get(id);
  }

  async getAll(): Promise<MemoryEntry[]> {
    return Array.from(this.cache.values());
  }

  async getByCategory(category: MemoryEntry['category']): Promise<MemoryEntry[]> {
    return Array.from(this.cache.values()).filter((entry) => entry.category === category);
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

  async syncWithAspenGroves(): Promise<boolean> {
    return this.reportUnimplementedFilesystemSync(
      'Aspen Grove',
      import.meta.env.VITE_ASPEN_GROVE_PATH,
    );
  }

  async syncWithGemini(): Promise<boolean> {
    return this.reportUnimplementedFilesystemSync(
      'Gemini',
      import.meta.env.VITE_GEMINI_PATH,
    );
  }

  private reportUnimplementedFilesystemSync(label: string, configuredPath?: string): false {
    const target = configuredPath?.trim();
    console.warn(
      target
        ? `[memory] ${label} target ${target} is configured, but no trusted filesystem bridge is implemented.`
        : `[memory] ${label} sync is unavailable: no target and no trusted filesystem bridge are configured.`,
    );
    return false;
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
      if (data) {
        const entries = JSON.parse(data) as [string, MemoryEntry][];
        for (const [key, value] of entries) this.cache.set(key, value);
      }
    } catch {
      // localStorage unavailable or invalid; start with an empty in-memory cache.
    }
  }
}

export const memory = new MemorySystem();
