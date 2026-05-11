import { useQuery } from '@tanstack/react-query';
import { getAnalytics } from '../lib/api';

export function AnalyticsPanel(): JSX.Element {
  const q = useQuery({ queryKey: ['analytics'], queryFn: getAnalytics });

  if (q.isLoading) {
    return <div className="mt-6 h-48 animate-pulse rounded-lg bg-gray-100" />;
  }
  if (q.isError) {
    return (
      <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Failed to load analytics.
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div className="mb-3 text-sm font-semibold">Analytics</div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg bg-gray-50 p-4 ring-1 ring-gray-200">
          <div className="text-xs text-gray-500">Approval Rate</div>
          <div className="mt-1 text-2xl font-semibold">{q.data.approvalRate.toFixed(1)}%</div>
        </div>
        <div className="rounded-lg bg-gray-50 p-4 ring-1 ring-gray-200">
          <div className="text-xs text-gray-500">Top Tag</div>
          <div className="mt-1 text-2xl font-semibold">
            {q.data.avgMarginByCategory[0]?.tag ?? '-'}
          </div>
        </div>
        <div className="rounded-lg bg-gray-50 p-4 ring-1 ring-gray-200">
          <div className="text-xs text-gray-500">Sources</div>
          <div className="mt-2 text-xs text-gray-700">
            {Object.entries(q.data.sourceBreakdown)
              .map(([k, v]) => `${k}: ${v.toFixed(0)}%`)
              .join(' · ')}
          </div>
        </div>
      </div>
    </div>
  );
}
