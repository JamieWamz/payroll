import { useEffect, useState } from 'react';
import { message, request } from './api';

export function useRemote<T>(path: string, revision = 0) {
  const [snapshot, setSnapshot] = useState<{ path: string; data: T }>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void request<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setSnapshot({ path, data: value });
          setError('');
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(message(failure));
      });
    return () => controller.abort();
  }, [path, revision]);
  return {
    data: error || snapshot?.path !== path ? undefined : snapshot?.data,
    error,
  };
}
