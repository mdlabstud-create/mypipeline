import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProductListing, Supplier } from '../lib/api';
import { approveListing, rejectListing, updateListing } from '../lib/api';
import { SupplierTable } from './SupplierTable';

export function ProductCard(props: {
  listing: ProductListing;
  suppliers?: Supplier[];
}): JSX.Element {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [title, setTitle] = useState(props.listing.title);
  const [retail, setRetail] = useState(props.listing.retailUsd);

  const approve = useMutation({
    mutationFn: () => approveListing(props.listing.id, 'admin'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] })
  });
  const reject = useMutation({
    mutationFn: () => rejectListing(props.listing.id, 'admin', reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] })
  });
  const save = useMutation({
    mutationFn: () => updateListing(props.listing.id, { title, retailUsd: retail }),
    onSuccess: () => {
      setEditMode(false);
      qc.invalidateQueries({ queryKey: ['products'] });
    }
  });

  const img = useMemo(() => props.listing.images?.[0] ?? '', [props.listing.images]);

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div className="flex gap-4">
        <div className="h-28 w-28 overflow-hidden rounded-lg bg-gray-100">
          {img ? (
            <img src={img} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="flex-1">
          {!editMode ? (
            <div className="text-base font-semibold">{props.listing.title}</div>
          ) : (
            <input
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
          <div className="mt-1 text-xs text-gray-500">
            Margin: {props.listing.marginPct.toFixed(2)}% · Retail: $
            {props.listing.retailUsd.toFixed(2)}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            className="rounded-md bg-green-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
          >
            Approve
          </button>
          <button
            className="rounded-md bg-gray-200 px-3 py-2 text-xs font-semibold text-gray-800"
            onClick={() => setEditMode((v) => !v)}
          >
            Edit
          </button>
        </div>
      </div>

      {editMode ? (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs text-gray-500">Retail price</label>
            <input
              type="number"
              className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
              value={retail}
              onChange={(e) => setRetail(Number(e.target.value))}
            />
          </div>
          <div className="flex items-end">
            <button
              className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              Save
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3">
        <SupplierTable suppliers={props.suppliers ?? []} />
      </div>

      <div className="mt-3 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
        <div className="text-xs font-semibold text-gray-700">Reject</div>
        <textarea
          className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
          placeholder="Rejection reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="mt-2">
          <button
            className="rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            onClick={() => reject.mutate()}
            disabled={reject.isPending || reason.trim().length === 0}
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
