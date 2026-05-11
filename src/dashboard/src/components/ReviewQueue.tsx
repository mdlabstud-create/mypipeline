import { useState } from 'react';
import { useProducts } from '../hooks/useProducts';
import { ProductCard } from './ProductCard';

export function ReviewQueue(): JSX.Element {
  const [status, setStatus] = useState('pending_review');
  const [limit, setLimit] = useState(20);
  const q = useProducts({ status, limit, offset: 0 });

  const options: Array<{ id: string; label: string }> = [
    { id: 'pending_review', label: 'Pending' },
    { id: 'approved', label: 'Approved' },
    { id: 'published', label: 'Published' },
    { id: 'duplicate', label: 'Duplicate' },
    { id: 'rejected', label: 'Rejected' }
  ];

  return (
    <div className="mt-6 rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">Review Queue</div>
        <div className="flex gap-2">
          {options.map((o) => (
            <button
              key={o.id}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${
                status === o.id
                  ? 'bg-gray-900 text-white ring-gray-900'
                  : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => setStatus(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : q.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load products.
        </div>
      ) : q.data.items.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500">
          No products for this filter.
        </div>
      ) : (
        <div>
          <div className="space-y-4">
            {q.data.items.map((l) => (
              <ProductCard key={l.id} listing={l} suppliers={l.suppliers ?? []} />
            ))}
          </div>
          <div className="mt-4 flex justify-center">
            <button
              className="rounded-md bg-gray-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              onClick={() => setLimit((v) => v + 20)}
              disabled={q.isFetching}
            >
              Load more
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
