import { useEffect, useState, useCallback } from 'react';
import { getDb } from '@/db/db';
import { getDesktopApi } from '@/lib/electronBridge';

interface UseDbInitResult {
  ready: boolean;
  error: string | null;
}

/** يقوم بتهيئة قاعدة البيانات عند بدء التشغيل */
export function useDbInit(): UseDbInitResult {
  const [ready, setReady] = useState(() => getDesktopApi() !== null);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(async () => {
    if (getDesktopApi()) return;
    try {
      await getDb();
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  return { ready, error };
}
