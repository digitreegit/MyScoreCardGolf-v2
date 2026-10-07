import { useCallback, useEffect, useState } from 'react';

import type { RoundWithHoles } from '@/domain/types';

import { onDataChanged } from './events';
import { getRound, listRounds } from './repository';

function useLoader<T>(load: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
    return onDataChanged(() => void reload());
  }, [reload]);

  return { data, loading, error, reload };
}

export function useRounds() {
  return useLoader<RoundWithHoles[]>(listRounds, []);
}

export function useRound(id: string) {
  const load = useCallback(() => getRound(id), [id]);
  return useLoader<RoundWithHoles | null>(load, null);
}
