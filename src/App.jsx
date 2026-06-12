import { useState, useEffect, useCallback } from 'react';
import { memory } from './memory';
import { workersManager } from './workers';
import './App.css';

function App() {
  const [memoryCount, setMemoryCount] = useState(0);
  const [systemStatus, setSystemStatus] = useState('');
  const workers = workersManager.getStatus();
  const workerCount = workers.length;

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

  const triggerOmniCrawl = useCallback(async () => {
    try {
      setSystemStatus('Triggering Omni-Crawl...');
      const res = await fetch(`http://${window.location.hostname}:8002/api/v1/trigger_omni_crawl`, { method: 'POST' });
      const data = await res.json();
      setSystemStatus(data.message);
    } catch (e) {
      setSystemStatus('Error triggering Omni-Crawl. Is the Nexus running?');
    }
  }, []);

  const triggerApexBoot = useCallback(async () => {
    try {
      setSystemStatus('Executing APEX Boot...');
      const res = await fetch(`http://${window.location.hostname}:8002/api/v1/trigger_apex_boot`, { method: 'POST' });
      const data = await res.json();
      setSystemStatus(data.message);
    } catch (e) {
      setSystemStatus('Error triggering APEX Boot. Is the Nexus running?');
    }
  }, []);

  const triggerMegaPdf = useCallback(async () => {
    try {
      setSystemStatus('Executing MEGA-PDF Reaper...');
      const res = await fetch(`http://${window.location.hostname}:8002/api/v1/trigger_mega_pdf`, { method: 'POST' });
      const data = await res.json();
      setSystemStatus(data.message);
    } catch (e) {
      setSystemStatus('Error triggering MEGA-PDF. Is the Nexus running?');
    }
  }, []);

  const triggerJuggernautOffice = useCallback(async () => {
    try {
      setSystemStatus('Engaging JUGGERNAUT-OFFICE...');
      const res = await fetch(`http://${window.location.hostname}:8002/api/v1/trigger_juggernaut_office`, { method: 'POST' });
      const data = await res.json();
      setSystemStatus(data.message);
    } catch (e) {
      setSystemStatus('Error triggering JUGGERNAUT-OFFICE. Is the Nexus running?');
    }
  }, []);

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
        <div className="status-pill" aria-label="runtime status">
          <span className="status-dot" />
          Live
        </div>
      </header>

      <section className="stats" aria-label="runtime metrics">
        <article className="stat-card">
          <span className="stat-label">Memory entries</span>
          <strong>{memoryCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Workers deployed</span>
          <strong>{workerCount}</strong>
        </article>
      </section>

      <section className="intelligence-layer">
          <div className="section-header">
              <h2>⚡ Super Pro Intelligence Core</h2>
          </div>
          <div className="button-group">
              <button className="btn interactive-btn" onClick={triggerOmniCrawl}>Launch Juggernaut Omni-Crawl</button>
              <button className="btn interactive-btn" onClick={triggerApexBoot}>Execute APEX Unified Boot</button>
              <button className="btn interactive-btn" onClick={triggerMegaPdf}>Run MEGA-PDF Reaper</button>
              <button className="btn interactive-btn" onClick={triggerJuggernautOffice}>Engage JUGGERNAUT-OFFICE</button>
          </div>
          {systemStatus && <p className="system-status-msg">{systemStatus}</p>}
      </section>

      <section className="workers-section" aria-labelledby="workers-heading">
        <div className="section-header">
          <div>
            <p className="eyebrow">Operational mesh</p>
            <h2 id="workers-heading">Active Workers</h2>
          </div>
          <p>{workerCount} nodes ready</p>
        </div>
        <div className="workers-list">
          {workers.map((worker) => (
            <article key={worker.id} className="worker-card">
              <div className="worker-card__top">
                <h3>{worker.name}</h3>
                <span>{worker.status}</span>
              </div>
              <p>{worker.capabilities.length} capabilities available</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default App;
