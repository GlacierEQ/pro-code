import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { memory } from './memory';
import { NOTION_WORKERS, workersManager } from './workers';
import type { WorkerConfig } from './workers';
import { useWorkerHealth } from './useWorkerHealth';
import './App.css';

const ACTIVE_CASE_ID = import.meta.env.VITE_CASE_ID?.trim() || 'CASE-LOCAL-DEMO';

type BtnKey = 'omniCrawl' | 'apexBoot' | 'megaPdf' | 'juggernautOffice' | 'quantumSovereign' | 'stealthSonic' | 'aeon777' | 'forensicPipeline';

type TriggerConfig = {
  label: string;
  capability: string;
  icon: string;
  tier: 'apex' | 'sovereign' | 'tactical';
};

const TRIGGERS: Record<BtnKey, TriggerConfig> = {
  quantumSovereign: { label: 'QUANTUM-SOVEREIGN Boot', capability: 'modelMaximize', icon: '⟁', tier: 'apex' },
  apexBoot: { label: 'APEX Unified Boot', capability: 'runApexMaximize', icon: '🚀', tier: 'apex' },
  stealthSonic: { label: 'Stealth Sonic → GHOST-EMBER', capability: 'automationDispatch', icon: '🎤', tier: 'sovereign' },
  aeon777: { label: 'AEON-777 Forensic Pipeline', capability: 'helixAutomation', icon: '🎯', tier: 'sovereign' },
  forensicPipeline: { label: 'Full Forensic Audio + Motions', capability: 'generateBatchMotions', icon: '⚖️', tier: 'sovereign' },
  omniCrawl: { label: 'Juggernaut Omni-Crawl', capability: 'crawlDatabase', icon: '🕷', tier: 'tactical' },
  megaPdf: { label: 'MEGA-PDF Reaper', capability: 'generateReport', icon: '📄', tier: 'tactical' },
  juggernautOffice: { label: 'JUGGERNAUT-OFFICE', capability: 'organizeMemory', icon: '📁', tier: 'tactical' },
};

const QS_AGENTS = [
  { id: 'GHOST-EMBER', model: 'Gemma 27B', role: 'Audio forensics + legal analysis', local: true, color: '#34d399' },
  { id: 'IRON-TALON', model: 'Ollama MCP', role: 'Voice fingerprinting + orchestration', local: true, color: '#60a5fa' },
  { id: 'ORACLE-NET', model: 'Perplexity', role: 'Federal statute research', local: false, color: '#a78bfa' },
  { id: 'ROOT-NEXUS', model: 'Aspen Grove', role: 'Persistent memory + GitHub sync', local: true, color: '#fb923c' },
];

const ALL_CAPABILITIES = NOTION_WORKERS.flatMap(worker =>
  worker.capabilities.map(capability => ({ cap: capability, worker: worker.name })),
);

type LogEntry = { ts: string; msg: string; level: 'info' | 'success' | 'error' | 'warn' };

function timestamp() {
  return new Date().toLocaleTimeString([], { hour12: false });
}

export default function App() {
  const [memoryCount, setMemoryCount] = useState(0);
  const [btnLoading, setBtnLoading] = useState<Map<BtnKey, boolean>>(new Map());
  const [btnStatus, setBtnStatus] = useState<Map<BtnKey, string>>(new Map());
  const [activeWorker, setActiveWorker] = useState<WorkerConfig | null>(null);
  const [capSearch, setCapSearch] = useState('');
  const [capResult, setCapResult] = useState<string | null>(null);
  const [capLoading, setCapLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'workers' | 'agents' | 'capabilities'>('workers');
  const [, setWorkerRevision] = useState(0);
  const previousOnline = useRef<boolean | null>(null);
  const { health, checking, recheck } = useWorkerHealth();

  const workers = workersManager.getStatus();
  const stats = workersManager.getStats();
  const nexusOnline = health?.status === 'ok';

  const addLog = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    setLogs(previous => [{ ts: timestamp(), msg, level }, ...previous].slice(0, 120));
  }, []);

  useEffect(() => {
    const online = health?.status === 'ok';
    if (!health) return;
    if (previousOnline.current === null) {
      addLog(online ? 'Local Nexus runtime connected' : 'Nexus runtime unavailable', online ? 'success' : 'warn');
    } else if (previousOnline.current !== online) {
      addLog(online ? 'Nexus runtime came online' : 'Nexus runtime went offline', online ? 'success' : 'error');
    }
    previousOnline.current = online;
    setWorkerRevision(value => value + 1);
  }, [health, addLog]);

  useEffect(() => {
    const initialize = async () => {
      await memory.store('app-initialized', 'Pro-Code runtime initialized', 'long-term', 'high');
      const entries = await memory.getAll();
      setMemoryCount(entries.length);
      addLog(`Memory loaded — ${entries.length} entries`, 'info');
    };
    void initialize();
  }, [addLog]);

  const dispatchCapability = useCallback(async (
    capability: string,
    params: Record<string, unknown> = {},
  ) => {
    setCapLoading(true);
    setCapResult(null);
    addLog(`Dispatch capability: ${capability}`, 'info');
    try {
      const result = await workersManager.execute(capability, params, { caseId: ACTIVE_CASE_ID });
      const detail = result.success
        ? result.result
        : `${result.error?.code ?? 'dispatch_failed'}: ${result.error?.message ?? 'No result'}`;
      setCapResult(`[${result.status.toUpperCase()}] ${result.worker} → ${detail} (${result.durationMs}ms)`);
      addLog(
        `${result.success ? '✓' : '✗'} ${capability} → ${result.worker} (${result.durationMs}ms)`,
        result.success ? 'success' : 'error',
      );
      setWorkerRevision(value => value + 1);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCapResult(`[FAILED] ${message}`);
      addLog(`✗ ${capability} error: ${message}`, 'error');
      return null;
    } finally {
      setCapLoading(false);
    }
  }, [addLog]);

  const triggerNexus = useCallback(async (key: BtnKey) => {
    const trigger = TRIGGERS[key];
    setBtnLoading(previous => new Map(previous).set(key, true));
    setBtnStatus(previous => {
      const next = new Map(previous);
      next.delete(key);
      return next;
    });
    const result = await dispatchCapability(trigger.capability, {
      trigger: key,
      source: 'command-console',
      requested_at: new Date().toISOString(),
    });
    const status = result?.success
      ? result.result ?? 'Completed'
      : result?.error?.message ?? 'Dispatch failed';
    setBtnStatus(previous => new Map(previous).set(key, status));
    setBtnLoading(previous => new Map(previous).set(key, false));
  }, [dispatchCapability]);

  const filteredCaps = ALL_CAPABILITIES.filter(({ cap }) =>
    cap.toLowerCase().includes(capSearch.toLowerCase()),
  );

  const nexusStatus = checking && !health ? 'checking' : nexusOnline ? 'online' : 'offline';
  const tierGroups = (['apex', 'sovereign', 'tactical'] as const).map(tier => ({
    tier,
    keys: (Object.keys(TRIGGERS) as BtnKey[]).filter(key => TRIGGERS[key].tier === tier),
  }));

  return (
    <div className="app">
      <header className="hero">
        <div className="hero__brand">
          <svg className="hero__logo" viewBox="0 0 40 40" fill="none" aria-label="Pro-Code">
            <polygon points="20,3 37,13 37,27 20,37 3,27 3,13" stroke="#38bdf8" strokeWidth="1.5" fill="none" opacity="0.6" />
            <polygon points="20,9 31,15.5 31,24.5 20,31 9,24.5 9,15.5" stroke="#818cf8" strokeWidth="1" fill="none" opacity="0.4" />
            <text x="11" y="25" fontFamily="monospace" fontWeight="bold" fontSize="14" fill="#f8fafc">⟁</text>
          </svg>
          <div>
            <p className="eyebrow">GlacierEQ · Governed Local Runtime</p>
            <h1>Pro&#8209;Code</h1>
            <p className="lede">Runnable case-scoped worker dispatch with idempotent receipts, local memory, and explicit runtime health.</p>
          </div>
        </div>
        <div className="hero__meta">
          <div className={`status-pill nexus-${nexusStatus}`} title={`Configured Nexus API — ${nexusStatus}`}>
            <span className="status-dot" />
            {nexusStatus === 'checking' ? 'Connecting…' : nexusStatus === 'online' ? 'Nexus Live' : 'Nexus Offline'}
          </div>
          <button className="log-toggle" onClick={() => setShowLog(value => !value)} aria-pressed={showLog}>
            {showLog ? 'Hide Log' : 'Show Log'}
            {logs.filter(log => log.level === 'error').length > 0 && (
              <span className="log-err-badge">{logs.filter(log => log.level === 'error').length}</span>
            )}
          </button>
        </div>
      </header>

      {showLog && (
        <div className="log-panel" aria-label="Runtime log">
          <div className="log-panel__header">
            <span>Runtime Log</span>
            <button onClick={() => setLogs([])} className="log-clear">Clear</button>
          </div>
          <div className="log-entries">
            {logs.length === 0 ? <p className="log-empty">No events yet.</p> : logs.map((log, index) => (
              <div key={`${log.ts}-${index}`} className={`log-entry log-entry--${log.level}`}>
                <span className="log-ts">{log.ts}</span>
                <span>{log.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <section className="stats" aria-label="Runtime metrics">
        {[
          { label: 'Memory', value: memoryCount },
          { label: 'Workers', value: stats.total },
          { label: 'Running', value: stats.running, highlight: stats.running > 0 },
          { label: 'Total Runs', value: stats.totalRuns },
          { label: 'Errors', value: stats.error, highlight: stats.error > 0, danger: true },
        ].map(({ label, value, highlight, danger }) => (
          <article key={label} className={`stat-card${highlight ? (danger ? ' stat-card--danger' : ' stat-card--active') : ''}`}>
            <span className="stat-label">{label}</span>
            <strong className={danger && value > 0 ? 'stat-error' : ''}>{value}</strong>
          </article>
        ))}
      </section>

      <section className="trigger-console" aria-labelledby="triggers-heading">
        <div className="section-header">
          <h2 id="triggers-heading"><span className="section-icon">⟁</span> Command Console</h2>
          <button className="log-toggle" onClick={() => void recheck()} disabled={checking}>
            {checking ? 'Checking…' : `Case: ${ACTIVE_CASE_ID}`}
          </button>
        </div>
        {tierGroups.map(({ tier, keys }) => (
          <div key={tier} className={`trigger-tier trigger-tier--${tier}`}>
            <p className="tier-label">{tier.toUpperCase()}</p>
            <div className="trigger-grid">
              {keys.map(key => {
                const trigger = TRIGGERS[key];
                const loading = btnLoading.get(key) === true;
                const status = btnStatus.get(key);
                return (
                  <div key={key} className="trigger-slot">
                    <button
                      className={`trigger-btn trigger-btn--${tier}`}
                      onClick={() => void triggerNexus(key)}
                      disabled={loading || !nexusOnline}
                      aria-busy={loading}
                    >
                      <span className="trigger-icon">{loading ? '⏳' : trigger.icon}</span>
                      <span className="trigger-label">{trigger.label}</span>
                    </button>
                    {status && <p className="trigger-status">{status}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

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

        {selectedTab === 'workers' && (
          <div className="workers-list" role="tabpanel">
            {workers.map(worker => (
              <article
                key={worker.id}
                className={`worker-card${activeWorker?.id === worker.id ? ' worker-card--selected' : ''}`}
                onClick={() => setActiveWorker(previous => previous?.id === worker.id ? null : worker)}
                tabIndex={0}
                onKeyDown={event => event.key === 'Enter' && setActiveWorker(previous => previous?.id === worker.id ? null : worker)}
                aria-expanded={activeWorker?.id === worker.id}
              >
                <div className="worker-card__top">
                  <h3>{worker.name}</h3>
                  <span className={`worker-badge worker-badge--${worker.status}`}>{worker.status}</span>
                </div>
                <p className="worker-caps-count">{worker.capabilities.length} capabilities</p>
                {activeWorker?.id === worker.id && (
                  <div className="worker-caps-list">
                    {worker.capabilities.map(capability => (
                      <button
                        key={capability}
                        className="cap-pill"
                        onClick={event => {
                          event.stopPropagation();
                          void dispatchCapability(capability);
                        }}
                        disabled={capLoading || !nexusOnline}
                        title={`Dispatch ${capability}`}
                      >
                        {capability}
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

        {selectedTab === 'agents' && (
          <div className="qs-agents" role="tabpanel">
            <p className="qs-caption">Agent identities are displayed as declared roles; the local runtime reports only verified worker availability.</p>
            <div className="qs-grid">
              {QS_AGENTS.map(agent => (
                <article key={agent.id} className="qs-card" style={{ '--qs-color': agent.color } as CSSProperties}>
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

        {selectedTab === 'capabilities' && (
          <div className="capabilities-panel" role="tabpanel">
            <div className="cap-search-row">
              <input
                className="cap-search"
                type="search"
                placeholder="Search capabilities…"
                value={capSearch}
                onChange={event => setCapSearch(event.target.value)}
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
                  disabled={capLoading || !nexusOnline}
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
