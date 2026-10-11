import { useCallback, useEffect, useState } from 'react';

import type { RoundWithHoles } from '@/domain/types';

import { onDataChanged } from './events';
import { getRound, listRounds } from './repository';

function useLoader<T>(load: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true; // ignore results that land after unmount or a change of `load`
    const run = () =>
      load().then(
        (d) => {
          if (!active) return;
          setData(d);
          setError(null);
          setLoading(false);
        },
        (e: unknown) => {
          if (!active) return;
          setError(e as Error);
          setLoading(false);
        },
      );
    void run();
    const off = onDataChanged(() => void run());
    return () => {
      active = false;
      off();
    };
  }, [load]);

  return { data, loading, error };
}

export function useRounds() {
  return useLoader<RoundWithHoles[]>(listRounds, []);
}

export function useRound(id: string) {
  const load = useCallback(() => getRound(id), [id]);
  return useLoader<RoundWithHoles | null>(load, null);
}
