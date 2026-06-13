import { useState, useEffect, useCallback, useRef } from 'react';
import { memory } from './memory';
import { workersManager } from './workers';
import './App.css';

const NEXUS = `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8002`;

type BtnKey = 'omniCrawl' | 'apexBoot' | 'megaPdf' | 'juggernautOffice';

const BTN_LABELS: Record<BtnKey, string> = {
  omniCrawl: 'Launch Juggernaut Omni-Crawl',
  apexBoot: 'Execute APEX Unified Boot',
  megaPdf: 'Run MEGA-PDF Reaper',
  juggernautOffice: 'Engage JUGGERNAUT-OFFICE',
};

const BTN_ENDPOINTS: Record<BtnKey, string> = {
  omniCrawl: '/api/v1/trigger_omni_crawl',
  apexBoot: '/api/v1/trigger_apex_boot',
  megaPdf: '/api/v1/trigger_mega_pdf',
  juggernautOffice: '/api/v1/trigger_juggernaut_office',
};

function App() {
  const [memoryCount, setMemoryCount] = useState(0);
  const [btnStatus, setBtnStatus] = useState<Map<BtnKey, string>>(new Map());
  const [btnLoading, setBtnLoading] = useState<Map<BtnKey, boolean>>(new Map());
  const [nexusOnline, setNexusOnline] = useState<boolean | null>(null);
  const healthRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const workers = workersManager.getStatus();
  const stats = workersManager.getStats();

  // ── health check ──────────────────────────────────────────────────────────
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${NEXUS}/health`, { method: 'GET', signal: AbortSignal.timeout(2000) });
      setNexusOnline(res.ok);
    } catch {
      setNexusOnline(false);
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    healthRef.current = setInterval(checkHealth, 15_000);
    return () => { if (healthRef.current) clearInterval(healthRef.current); };
  }, [checkHealth]);

  // ── memory init ───────────────────────────────────────────────────────────
  useEffect(() => {
    const initialize = async () => {
      await memory.store(
        'app-initialized',
        'Pro-Code app initialized with Notion workers integration',
        'long-term',
        'high',
      );
      const entries = await memory.getAll();
      setMemoryCount(entries.length);
    };
    void initialize();
  }, []);

  // ── nexus trigger (generic) ───────────────────────────────────────────────
  const triggerNexus = useCallback(async (key: BtnKey) => {
    setBtnLoading(prev => new Map(prev).set(key, true));
    setBtnStatus(prev => new Map(prev).set(key, `Triggering ${BTN_LABELS[key]}…`));
    try {
      const res = await fetch(`${NEXUS}${BTN_ENDPOINTS[key]}`, { method: 'POST' });
      const data = await res.json() as { message?: string };
      setBtnStatus(prev => new Map(prev).set(key, data.message ?? 'Done.'));
      // record in workers manager
      await workersManager.execute(key, { triggeredAt: new Date().toISOString() });
    } catch {
      setBtnStatus(prev => new Map(prev).set(key, `Error — is the Nexus running?`));
    } finally {
      setBtnLoading(prev => new Map(prev).set(key, false));
    }
  }, []);

  const nexusStatus = nexusOnline === null ? 'checking' : nexusOnline ? 'online' : 'offline';

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Apex / Notion runtime</p>
          <h1>Pro-Code Control Surface</h1>
          <p className="lede">
            Memory writes and worker routing are synced for the current session.
          </p>
        </div>
        <div className={`status-pill nexus-${nexusStatus}`} aria-label="runtime status" title={`Nexus API: ${nexusStatus}`}>
          <span className="status-dot" />
          {nexusStatus === 'checking' ? 'Connecting…' : nexusStatus === 'online' ? 'Live' : 'Nexus Offline'}
        </div>
      </header>

      <section className="stats" aria-label="runtime metrics">
        <article className="stat-card">
          <span className="stat-label">Memory entries</span>
          <strong>{memoryCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Workers deployed</span>
          <strong>{stats.deployed}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Total runs</span>
          <strong>{stats.totalRuns}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Error state</span>
          <strong className={stats.error > 0 ? 'stat-error' : ''}>{stats.error}</strong>
        </article>
      </section>

      <section className="intelligence-layer">
        <div className="section-header">
          <h2>⚡ Super Pro Intelligence Core</h2>
          {nexusOnline === false && (
            <span className="nexus-warning">⚠ Nexus offline — buttons disabled</span>
          )}
        </div>
        <div className="button-group">
          {(Object.keys(BTN_LABELS) as BtnKey[]).map((key) => (
            <div key={key} className="btn-wrapper">
              <button
                className="btn interactive-btn"
                onClick={() => void triggerNexus(key)}
                disabled={!nexusOnline || btnLoading.get(key) === true}
                title={!nexusOnline ? 'Nexus is offline' : undefined}
                aria-busy={btnLoading.get(key) === true}
              >
                {btnLoading.get(key) ? '⏳ ' : ''}{BTN_LABELS[key]}
              </button>
              {btnStatus.get(key) && (
                <p className="system-status-msg">{btnStatus.get(key)}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="workers-section" aria-labelledby="workers-heading">
        <div className="section-header">
          <div>
            <p className="eyebrow">Operational mesh</p>
            <h2 id="workers-heading">Active Workers</h2>
          </div>
          <p>{stats.deployed} nodes ready</p>
        </div>
        <div className="workers-list">
          {workers.map((worker) => (
            <article key={worker.id} className="worker-card">
              <div className="worker-card__top">
                <h3>{worker.name}</h3>
                <span className={`worker-badge worker-badge--${worker.status}`}>{worker.status}</span>
              </div>
              <p>{worker.capabilities.length} capabilities available</p>
              <div className="worker-telemetry">
                <span className="telemetry-item" title="Total runs">
                  🔁 {worker.runsCount} run{worker.runsCount !== 1 ? 's' : ''}
                </span>
                {worker.lastRun && (
                  <span className="telemetry-item" title="Last execution">
                    🕐 {new Date(worker.lastRun).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default App;
