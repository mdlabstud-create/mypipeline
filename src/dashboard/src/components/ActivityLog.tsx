import { useMemo, useState } from 'react';
import { usePipeline } from '../hooks/usePipeline';

export function ActivityLog(): JSX.Element {
  const { events, connected } = usePipeline();
  const [filter, setFilter] = useState<'all' | 'ok' | 'warn' | 'error'>('all');

  const shown = useMemo(() => {
    if (filter === 'all') return events;
    return events.filter((e) => e.status === filter);
  }, [events, filter]);

  return (
    <div className="mt-6 rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">
          Activity Log{' '}
          <span className="ml-2 text-xs text-gray-500">
            {connected ? 'connected' : 'disconnected'}
          </span>
        </div>
        <div className="flex gap-2">
          {(['all', 'ok', 'warn', 'error'] as const).map((f) => (
            <button
              key={f}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${
                filter === f
                  ? 'bg-gray-900 text-white ring-gray-900'
                  : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => setFilter(f)}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-72 overflow-auto rounded-lg bg-gray-50 p-2 ring-1 ring-gray-200">
        {shown.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">No events.</div>
        ) : (
          <div className="space-y-2">
            {shown.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-xs ring-1 ring-gray-100"
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    e.status === 'ok'
                      ? 'bg-green-500'
                      : e.status === 'warn'
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                />
                <span className="font-mono text-gray-500">{e.stage}</span>
                <span className="text-gray-800">{e.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
