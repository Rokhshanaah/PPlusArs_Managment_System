import { useCallback, useEffect, useState } from 'react';
import { api, messageOf } from '../api/client.js';

export function useApiData(url, { event } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get(url);
      setData(response.data.data);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!event) return undefined;
    const events = Array.isArray(event) ? event : [event];
    const handler = () => load();
    events.forEach((name) => window.addEventListener(name, handler));
    return () => events.forEach((name) => window.removeEventListener(name, handler));
  }, [event, load]);

  return { data, loading, error, reload: load, setData };
}
