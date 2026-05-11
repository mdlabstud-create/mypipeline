import type { Supplier } from '../lib/api';

function Badge(props: { text: string; cls: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${props.cls}`}>
      {props.text}
    </span>
  );
}

export function SupplierTable(props: { suppliers: Supplier[] }): JSX.Element {
  if (props.suppliers.length === 0) {
    return <div className="text-xs text-gray-500">No supplier data</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-gray-200">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-3 py-2">Platform</th>
            <th className="px-3 py-2">Price</th>
            <th className="px-3 py-2">MOQ</th>
            <th className="px-3 py-2">Rating</th>
            <th className="px-3 py-2">Shipping</th>
            <th className="px-3 py-2">Score</th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {props.suppliers.map((s) => {
            const plat =
              s.platform === 'aliexpress'
                ? { t: 'AliExpress', c: 'bg-blue-100 text-blue-800' }
                : s.platform === 'alibaba'
                  ? { t: 'Alibaba', c: 'bg-orange-100 text-orange-800' }
                  : { t: '1688', c: 'bg-red-100 text-red-800' };
            return (
              <tr
                key={s.id}
                className={s.rank === 1 ? 'bg-blue-50' : 'border-t border-gray-100'}
              >
                <td className="px-3 py-2">
                  <Badge text={plat.t} cls={plat.c} />
                </td>
                <td className="px-3 py-2">${s.priceUsd.toFixed(2)}</td>
                <td className="px-3 py-2">{s.moq}</td>
                <td className="px-3 py-2">{s.rating ?? '-'}</td>
                <td className="px-3 py-2">
                  {s.shippingDays ? `${s.shippingDays}d` : '-'}
                </td>
                <td className="px-3 py-2">
                  {s.supplierScore !== undefined && s.supplierScore !== null
                    ? Number(s.supplierScore).toFixed(2)
                    : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
