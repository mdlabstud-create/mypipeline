import { useQuery } from '@tanstack/react-query';
import { getMetrics } from '../lib/api';

function Card(props: { label: string; value: string; sub: string }): JSX.Element {
  return (
    <div className="rounded-lg bg-gray-50 p-4 ring-1 ring-gray-200">
      <div className="text-xs text-gray-500">{props.label}</div>
      <div className="mt-1 text-2xl font-semibold">{props.value}</div>
      <div className="mt-1 text-xs text-gray-400">{props.sub}</div>
    </div>
  );
}

export function MetricsBar(): JSX.Element {
  const q = useQuery({
    queryKey: ['metrics'],
    queryFn: getMetrics,
    refetchInterval: 30000
  });

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[92px] animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Failed to load metrics. Refresh to retry.
      </div>
    );
  }

  const m = q.data;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      <Card
        label="Products Found Today"
        value={String(m.productsFoundToday)}
        sub="Trending products discovered today"
      />
      <Card
        label="Pending Review"
        value={String(m.pendingReview)}
        sub="Listings waiting for approval"
      />
      <Card
        label="Published Today"
        value={String(m.publishedToday)}
        sub="Drafts created in Shopify today"
      />
      <Card
        label="Avg Margin %"
        value={`${m.avgMarginPct.toFixed(2)}%`}
        sub="Average margin for published listings"
      />
    </div>
  );
}