import { useEffect, useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { triggerPipeline } from '../lib/api';

export function SettingsPanel(): JSX.Element {
  const { query, mutation } = useSettings();
  const [markup, setMarkup] = useState(2.8);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null);

  useEffect(() => {
    const v = query.data?.markupMultiplier;
    if (v) setMarkup(Number(v));
  }, [query.data]);

  return (
    <div className="mt-6 rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div className="mb-3 text-sm font-semibold">Settings</div>

      {query.isLoading ? (
        <div className="h-24 animate-pulse rounded-lg bg-gray-100" />
      ) : query.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load settings.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs text-gray-500">Markup Multiplier</label>
            <input
              type="range"
              min={1.5}
              max={5.0}
              step={0.1}
              value={markup}
              onChange={(e) => setMarkup(Number(e.target.value))}
              className="mt-2 w-full"
            />
            <div className="mt-1 text-xs text-gray-600">{markup.toFixed(1)}</div>
          </div>
          <div className="flex items-end gap-2">
            <button
              className="rounded-md bg-gray-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              onClick={() => mutation.mutate({ markupMultiplier: markup })}
              disabled={mutation.isPending}
            >
              Save
            </button>
            <button
              className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              onClick={async () => {
                try {
                  setTriggering(true);
                  setTriggerMsg(null);
                  await triggerPipeline();
                  setTriggerMsg('Triggered. Watch Activity Log and Bull Board.');
                } catch (e: unknown) {
                  setTriggerMsg(e instanceof Error ? e.message : 'Failed to trigger pipeline');
                } finally {
                  setTriggering(false);
                }
              }}
              disabled={triggering}
            >
              {triggering ? 'Triggering…' : 'Trigger pipeline'}
            </button>
          </div>
          {triggerMsg ? (
            <div className="md:col-span-2 text-xs text-gray-600">{triggerMsg}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
