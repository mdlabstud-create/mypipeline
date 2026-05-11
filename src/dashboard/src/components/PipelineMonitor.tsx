import { useQuery } from '@tanstack/react-query';
import { getMetrics } from '../lib/api';

function Pill(props: { label: string; state: 'idle' | 'active' | 'error'; value: string }) {
  const cls =
    props.state === 'error'
      ? 'bg-red-100 text-red-800 ring-red-200'
      : props.state === 'active'
        ? 'bg-blue-100 text-blue-800 ring-blue-200'
        : 'bg-gray-100 text-gray-700 ring-gray-200';
  return (
    <div className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${cls}`}>
      {props.label} · {props.value}
    </div>
  );
}

export function PipelineMonitor(): JSX.Element {
  const q = useQuery({ queryKey: ['metrics'], queryFn: getMetrics, refetchInterval: 30000 });
  const active = q.data ? q.data.pendingReview > 0 : false;
  return (
    <div className="mt-6 rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div className="mb-3 text-sm font-semibold">Pipeline</div>
      <div className="flex flex-wrap gap-2">
        <Pill label="TikTok" state={active ? 'active' : 'idle'} value="-" />
        <Pill label="Amazon" state={active ? 'active' : 'idle'} value="-" />
        <Pill label="Merge" state="idle" value="-" />
        <Pill label="Research" state="idle" value="-" />
        <Pill label="Content" state="idle" value="-" />
        <Pill label="Publish" state="idle" value="-" />
      </div>
      <div className="mt-3 text-xs text-gray-500">
        Bull Board is available at <span className="font-mono">/admin/queues</span>.
      </div>
    </div>
  );
}
