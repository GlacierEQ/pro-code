/**
 * useWorkerHealth — React hook
 * Polls nexus-api /health every 30s and syncs worker statuses into WorkersManager.
 * Returns live nexus health for banner/indicator use.
 */
import { useState, useEffect, useCallback } from 'react';
import { workersManager, type NexusHealth } from './workers';

const POLL_INTERVAL_MS = 30_000;

export function useWorkerHealth() {
  const [health, setHealth] = useState<NexusHealth | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const result = await workersManager.syncFromRuntime();
      setHealth(result);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // immediate check on mount
    void check();
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  return { health, checking, recheck: check };
}
