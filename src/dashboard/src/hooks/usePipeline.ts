import { useEffect, useMemo, useState } from 'react';
import type { PipelineEvent } from '../lib/api';

export function usePipeline() {
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as PipelineEvent;
        setEvents((prev) => [ev, ...prev].slice(0, 200));
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, []);

  return useMemo(() => ({ events, connected }), [events, connected]);
}
