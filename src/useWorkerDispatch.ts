/**
 * useWorkerDispatch — React hook
 * Wraps WorkersManager.execute() with loading/error state for UI consumption.
 */
import { useState, useCallback } from 'react';
import { workersManager, type ExecuteResult } from './workers';

export function useWorkerDispatch() {
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<ExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback(
    async (capability: string, params?: Record<string, unknown>) => {
      setLoading(true);
      setError(null);
      try {
        const result = await workersManager.execute(capability, params);
        setLastResult(result);
        if (!result.live) {
          setError(`Nexus unreachable — running in fallback mode. (${result.result})`);
        }
        return result;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { dispatch, loading, lastResult, error };
}
