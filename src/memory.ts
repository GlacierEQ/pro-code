/**
 * Memory System for Pro-Code
 * Integrates with Aspen Groves, Notion Workers, and comet-agent API.
 * Note: localStorage calls are wrapped defensively — sandboxed envs may block them.
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
    const entry: MemoryEntry = { id, content, category, priority, timestamp: new Date().toISOString() };
    this.cache.set(id, entry);
    this.persistToStorage();

    // Non-blocking sync to comet-agent context manager
    fetch(`${COMET_AGENT_URL}/context/${this.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { [id]: entry } }),
      signal: AbortSignal.timeout(3_000),
    }).catch(() => { /* comet-agent not available — continue with local cache */ });
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    return this.cache.get(id);
  }

  async getAll(): Promise<MemoryEntry[]> {
    return Array.from(this.cache.values());
  }

  async getByCategory(category: MemoryEntry['category']): Promise<MemoryEntry[]> {
    return Array.from(this.cache.values()).filter(e => e.category === category);
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

  async getStats(): Promise<{ total: number; byCategory: Record<string, number>; byPriority: Record<string, number> }> {
    const entries = Array.from(this.cache.values());
    const byCategory: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const entry of entries) {
      byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
      byPriority[entry.priority] = (byPriority[entry.priority] ?? 0) + 1;
    }
    return { total: entries.length, byCategory, byPriority };
  }

  // Stubs — paths resolved at runtime via env/config, not hardcoded
  async syncWithAspenGroves(): Promise<boolean> {
    const path = import.meta.env?.VITE_ASPEN_GROVE_PATH ?? `${process.env['HOME'] ?? '~'}/00_STRATEGY_CORE`;
    console.info(`[memory] Aspen Grove sync target: ${path}`);
    return true;
  }

  async syncWithGemini(): Promise<boolean> {
    const path = import.meta.env?.VITE_GEMINI_PATH ?? `${process.env['HOME'] ?? '~'}/.gemini`;
    console.info(`[memory] Gemini sync target: ${path}`);
    return true;
  }

  private persistToStorage(): void {
    try {
      const data = JSON.stringify(Array.from(this.cache.entries()));
      localStorage.setItem('procode-memory', data);
    } catch { /* localStorage not available — in-memory only */ }
  }

  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem('procode-memory');
      if (data) {
        const entries = JSON.parse(data) as [string, MemoryEntry][];
        for (const [key, value] of entries) this.cache.set(key, value);
      }
    } catch { /* localStorage not available */ }
  }
}

export const memory = new MemorySystem();
