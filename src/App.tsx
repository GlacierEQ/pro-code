import { useState, useEffect, useCallback, useRef } from 'react';
import { memory } from './memory';
import { getNexusBaseUrl, workersManager, NOTION_WORKERS } from './workers';
import type { WorkerConfig } from './workers';
import './App.css';

const NEXUS = getNexusBaseUrl();
const ACTIVE_CASE_ID = import.meta.env.VITE_CASE_ID?.trim();

// ── Trigger buttons ──────────────────────────────────────────────────────────
type BtnKey = 'omniCrawl' | 'apexBoot' | 'megaPdf' | 'juggernautOffice' | 'quantumSovereign' | 'stealthSonic' | 'aeon777' | 'forensicPipeline';

const TRIGGERS: Record<BtnKey, { label: string; endpoint: string; icon: string; tier: 'apex' | 'sovereign' | 'tactical' }> = {
  quantumSovereign:  { label: 'QUANTUM-SOVEREIGN Boot',        endpoint: '/api/v1/trigger_quantum_sovereign',  icon: '⟁',  tier: 'apex' },
  apexBoot:          { label: 'APEX Unified Boot',             endpoint: '/api/v1/trigger_apex_boot',          icon: '🚀', tier: 'apex' },
  stealthSonic:      { label: 'Stealth Sonic → GHOST-EMBER',   endpoint: '/api/v1/trigger_stealth_sonic',      icon: '🎤', tier: 'sovereign' },
  aeon777:           { label: 'AEON-777 Forensic Pipeline',    endpoint: '/api/v1/trigger_aeon777',            icon: '🎯', tier: 'sovereign' },
  forensicPipeline:  { label: 'Full Forensic Audio + Motions', endpoint: '/api/v1/trigger_forensic_pipeline',  icon: '⚖️', tier: 'sovereign' },
  omniCrawl:         { label: 'Juggernaut Omni-Crawl',         endpoint: '/api/v1/trigger_omni_crawl',         icon: '🕷',  tier: 'tactical' },
  megaPdf:           { label: 'MEGA-PDF Reaper',               endpoint: '/api/v1/trigger_mega_pdf',           icon: '📄', tier: 'tactical' },
  juggernautOffice:  { label: 'JUGGERNAUT-OFFICE',             endpoint: '/api/v1/trigger_juggernaut_office',  icon: '📁', tier: 'tactical' },
};

// ── QUANTUM-SOVEREIGN agents ─────────────────────────────────────────────────
const QS_AGENTS = [
  { id: 'GHOST-EMBER',  model: 'Gemma 27B',   role: 'Audio forensics + legal analysis',    local: true,  color: '#34d399' },
  { id: 'IRON-TALON',  model: 'Ollama MCP',   role: 'Voice fingerprinting + orchestration', local: true,  color: '#60a5fa' },
  { id: 'ORACLE-NET',  model: 'Perplexity',   role: 'Federal statute research',             local: false, color: '#a78bfa' },
  { id: 'ROOT-NEXUS',  model: 'Aspen Grove',  role: 'Persistent memory + GitHub sync',      local: true,  color: '#fb923c' },
];

// ── Capability map for quick dispatch ────────────────────────────────────────
const ALL_CAPABILITIES = NOTION_WORKERS.flatMap(w => w.capabilities.map(c => ({ cap: c, worker: w.name })));

type LogEntry = { ts: string; msg: string; level: 'info' | 'success' | 'error' | 'warn' };

function timestamp() { return new Date().toLocaleTimeString([], { hour12: false }); }

export default function App() {
  const [memoryCount, setMemoryCount]     = useState(0);
  const [btnLoading, setBtnLoading]       = useState<Map<BtnKey, boolean>>(new Map());
  const [btnStatus, setBtnStatus]         = useState<Map<BtnKey, string>>(new Map());
  const [nexusOnline, setNexusOnline]     = useState<boolean | null>(null);
  const [activeWorker, setActiveWorker]   = useState<WorkerConfig | null>(null);
  const [capSearch, setCapSearch]         = useState('');
  const [capResult, setCapResult]         = useState<string | null>(null);
  const [capLoading, setCapLoading]       = useState(false);
  const [logs, setLogs]                   = useState<LogEntry[]>([]);
  const [showLog, setShowLog]             = useState(false);
  const [selectedTab, setSelectedTab]     = useState<'workers' | 'agents' | 'capabilities'>('workers');
  const healthRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef    = useRef<HTMLDivElement>(null);

  const workers = workersManager.getStatus();
  const stats   = workersManager.getStats();

  const addLog = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    setLogs(prev => [{ ts: timestamp(), msg, level }, ...prev].slice(0, 120));
  }, []);

  // ── health ─────────────────────────────────────────────────────────────────
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${NEXUS}/health`, { signal: AbortSignal.timeout(2000) });
      const wasOnline = nexusOnline;
      setNexusOnline(res.ok);
      if (!wasOnline && res.ok) addLog('Nexus API came online', 'success');
      if (wasOnline && !res.ok) addLog('Nexus API went offline', 'error');
    } catch {
      if (nexusOnline !== false) addLog('Nexus API unreachable', 'warn');
      setNexusOnline(false);
    }
  }, [nexusOnline, addLog]);

  useEffect(() => {
    void checkHealth();
    healthRef.current = setInterval(checkHealth, 15_000);
    return () => { if (healthRef.current) clearInterval(healthRef.current); };
  }, [checkHealth]);

  // ── memory init ────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      await memory.store('app-initialized', 'Pro-Code Ascension Layer initialized', 'long-term', 'high');
      const entries = await memory.getAll();
      setMemoryCount(entries.length);
      addLog(`Memory loaded — ${entries.length} entries`, 'info');
    };
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── legacy pipeline triggers ─────────────────────────────────────────────────
  const triggerNexus = useCallback((key: BtnKey) => {
    const message = 'Blocked: legacy pipeline endpoints do not implement the case-scoped dispatch contract.';
    setBtnLoading(prev => new Map(prev).set(key, false));
    setBtnStatus(prev => new Map(prev).set(key, message));
    addLog(`✗ ${TRIGGERS[key].label}: ${message}`, 'error');
  }, [addLog]);

  // ── capability dispatch ────────────────────────────────────────────────────
  const dispatchCapability = useCallback(async (cap: string) => {
    setCapLoading(true);
    setCapResult(null);
    addLog(`Dispatch capability: ${cap}`, 'info');
    try {
      const result = await workersManager.execute(cap, {}, { caseId: ACTIVE_CASE_ID });
      const detail = result.success
        ? result.result
        : `${result.error?.code ?? 'dispatch_failed'}: ${result.error?.message ?? 'No result'}`;
      setCapResult(`[${result.status.toUpperCase()}] ${result.worker} → ${detail} (${result.durationMs}ms)`);
      addLog(
        `${result.success ? '✓' : '✗'} ${cap} → ${result.worker} (${result.durationMs}ms)`,
        result.success ? 'success' : 'error',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCapResult(`[FAILED] ${message}`);
      addLog(`✗ ${cap} error: ${message}`, 'error');
    } finally {
      setCapLoading(false);
    }
  }, [addLog]);

  const filteredCaps = ALL_CAPABILITIES.filter(({ cap }) =>
    cap.toLowerCase().includes(capSearch.toLowerCase()),
  );

  const nexusStatus = nexusOnline === null ? 'checking' : nexusOnline ? 'online' : 'offline';
  const tierGroups = (['apex', 'sovereign', 'tactical'] as const).map(tier => ({
    tier,
    keys: (Object.keys(TRIGGERS) as BtnKey[]).filter(k => TRIGGERS[k].tier === tier),
  }));

  return (
    <div className="app">
      {/* ── HEADER ───────────────────────────────────────────────────────── */}
      <header className="hero">
        <div className="hero__brand">
          <svg className="hero__logo" viewBox="0 0 40 40" fill="none" aria-label="Pro-Code">
            <polygon points="20,3 37,13 37,27 20,37 3,27 3,13" stroke="#38bdf8" strokeWidth="1.5" fill="none" opacity="0.6"/>
            <polygon points="20,9 31,15.5 31,24.5 20,31 9,24.5 9,15.5" stroke="#818cf8" strokeWidth="1" fill="none" opacity="0.4"/>
            <text x="11" y="25" fontFamily="monospace" fontWeight="bold" fontSize="14" fill="#f8fafc">⟁</text>
          </svg>
          <div>
            <p className="eyebrow">GlacierEQ · APEX Runtime</p>
            <h1>Pro&#8209;Code</h1>
            <p className="lede">QUANTUM-SOVEREIGN orchestration layer — 15-worker Notion mesh, forensic pipeline, federal motion generation.</p>
          </div>
        </div>
        <div className="hero__meta">
          <div className={`status-pill nexus-${nexusStatus}`} title={`Configured Nexus API — ${nexusStatus}`}>
            <span className="status-dot" />
            {nexusStatus === 'checking' ? 'Connecting…' : nexusStatus === 'online' ? 'Nexus Live' : 'Nexus Offline'}
          </div>
          <button className="log-toggle" onClick={() => setShowLog(v => !v)} aria-pressed={showLog}>
            {showLog ? 'Hide Log' : 'Show Log'}
            {logs.filter(l => l.level === 'error').length > 0 && <span className="log-err-badge">{logs.filter(l => l.level === 'error').length}</span>}
          </button>
        </div>
      </header>

      {/* ── RUNTIME LOG ──────────────────────────────────────────────────── */}
      {showLog && (
        <div className="log-panel" ref={logRef} aria-label="Runtime log">
          <div className="log-panel__header">
            <span>Runtime Log</span>
            <button onClick={() => setLogs([])} className="log-clear">Clear</button>
          </div>
          <div className="log-entries">
            {logs.length === 0 ? <p className="log-empty">No events yet.</p> : logs.map((l, i) => (
              <div key={i} className={`log-entry log-entry--${l.level}`}>
                <span className="log-ts">{l.ts}</span>
                <span>{l.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── STATS ────────────────────────────────────────────────────────── */}
      <section className="stats" aria-label="Runtime metrics">
        {[
          { label: 'Memory',     value: memoryCount },
          { label: 'Workers',    value: stats.total },
          { label: 'Running',    value: stats.running,  highlight: stats.running > 0 },
          { label: 'Total Runs', value: stats.totalRuns },
          { label: 'Errors',     value: stats.error,    highlight: stats.error > 0, danger: true },
        ].map(({ label, value, highlight, danger }) => (
          <article key={label} className={`stat-card${highlight ? (danger ? ' stat-card--danger' : ' stat-card--active') : ''}`}>
            <span className="stat-label">{label}</span>
            <strong className={danger && (value as number) > 0 ? 'stat-error' : ''}>{value}</strong>
          </article>
        ))}
      </section>

      {/* ── TRIGGER CONSOLE ──────────────────────────────────────────────── */}
      <section className="trigger-console" aria-labelledby="triggers-heading">
        <div className="section-header">
          <h2 id="triggers-heading"><span className="section-icon">⟁</span> Command Console</h2>
          <span className="nexus-warning">⚠ Legacy raw triggers disabled — use case-scoped worker dispatch</span>
        </div>
        {tierGroups.map(({ tier, keys }) => (
          <div key={tier} className={`trigger-tier trigger-tier--${tier}`}>
            <p className="tier-label">{tier.toUpperCase()}</p>
            <div className="trigger-grid">
              {keys.map(key => {
                const t = TRIGGERS[key];
                const loading = btnLoading.get(key) === true;
                const status  = btnStatus.get(key);
                return (
                  <div key={key} className="trigger-slot">
                    <button
                      className={`trigger-btn trigger-btn--${tier}`}
                      onClick={() => void triggerNexus(key)}
                      disabled={true}
                      aria-busy={loading}
                    >
                      <span className="trigger-icon">{loading ? '⏳' : t.icon}</span>
                      <span className="trigger-label">{t.label}</span>
                    </button>
                    {status && <p className="trigger-status">{status}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {/* ── TABBED LOWER PANEL ───────────────────────────────────────────── */}
      <div className="lower-panel">
        <nav className="tab-nav" role="tablist">
          {(['workers', 'agents', 'capabilities'] as const).map(tab => (
            <button
              key={tab}
              role="tab"
              aria-selected={selectedTab === tab}
              className={`tab-btn${selectedTab === tab ? ' tab-btn--active' : ''}`}
              onClick={() => setSelectedTab(tab)}
            >
              {tab === 'workers' ? `Workers (${stats.total})` : tab === 'agents' ? 'QS Agents' : 'Capabilities'}
            </button>
          ))}
        </nav>

        {/* Workers */}
        {selectedTab === 'workers' && (
          <div className="workers-list" role="tabpanel">
            {workers.map(worker => (
              <article
                key={worker.id}
                className={`worker-card${activeWorker?.id === worker.id ? ' worker-card--selected' : ''}`}
                onClick={() => setActiveWorker(prev => prev?.id === worker.id ? null : worker)}
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setActiveWorker(prev => prev?.id === worker.id ? null : worker)}
                aria-expanded={activeWorker?.id === worker.id}
              >
                <div className="worker-card__top">
                  <h3>{worker.name}</h3>
                  <span className={`worker-badge worker-badge--${worker.status}`}>{worker.status}</span>
                </div>
                <p className="worker-caps-count">{worker.capabilities.length} capabilities</p>
                {activeWorker?.id === worker.id && (
                  <div className="worker-caps-list">
                    {worker.capabilities.map(cap => (
                      <button
                        key={cap}
                        className="cap-pill"
                        onClick={e => { e.stopPropagation(); void dispatchCapability(cap); }}
                        disabled={capLoading}
                        title={`Dispatch ${cap}`}
                      >
                        {cap}
                      </button>
                    ))}
                  </div>
                )}
                <div className="worker-telemetry">
                  <span className="telemetry-item">🔁 {worker.runsCount} run{worker.runsCount !== 1 ? 's' : ''}</span>
                  {worker.lastRun && <span className="telemetry-item">🕐 {new Date(worker.lastRun).toLocaleTimeString()}</span>}
                  {worker.lastError && <span className="telemetry-item telemetry-item--error" title={worker.lastError}>⚠ err</span>}
                </div>
              </article>
            ))}
          </div>
        )}

        {/* QS Agents */}
        {selectedTab === 'agents' && (
          <div className="qs-agents" role="tabpanel">
            <p className="qs-caption">QUANTUM-SOVEREIGN TRIAD — `.shadow/stealth_codex_v3.yaml` · 4-agent zero-cloud-egress architecture</p>
            <div className="qs-grid">
              {QS_AGENTS.map(agent => (
                <article key={agent.id} className="qs-card" style={{ '--qs-color': agent.color } as React.CSSProperties}>
                  <div className="qs-card__top">
                    <h3>{agent.id}</h3>
                    <span className={`qs-badge${agent.local ? ' qs-badge--local' : ' qs-badge--cloud'}`}>{agent.local ? 'local' : 'cloud'}</span>
                  </div>
                  <p className="qs-model">{agent.model}</p>
                  <p className="qs-role">{agent.role}</p>
                </article>
              ))}
            </div>
          </div>
        )}

        {/* Capabilities */}
        {selectedTab === 'capabilities' && (
          <div className="capabilities-panel" role="tabpanel">
            <div className="cap-search-row">
              <input
                className="cap-search"
                type="search"
                placeholder="Search capabilities…"
                value={capSearch}
                onChange={e => setCapSearch(e.target.value)}
                aria-label="Search capabilities"
              />
              {capLoading && <span className="cap-spinning">⏳</span>}
            </div>
            {capResult && (
              <div className={`cap-result${capResult.startsWith('[SUCCEEDED]') ? '' : ' cap-result--error'}`}>
                <code>{capResult}</code>
              </div>
            )}
            <div className="cap-grid">
              {filteredCaps.map(({ cap, worker }) => (
                <button
                  key={`${worker}__${cap}`}
                  className="cap-card"
                  onClick={() => void dispatchCapability(cap)}
                  disabled={capLoading}
                  title={`Worker: ${worker}`}
                >
                  <span className="cap-name">{cap}</span>
                  <span className="cap-worker">{worker}</span>
                </button>
              ))}
              {filteredCaps.length === 0 && <p className="cap-empty">No capabilities match &ldquo;{capSearch}&rdquo;</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
