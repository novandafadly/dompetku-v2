import type { Rupiah } from '@dompetku/domain';
import { MoneyText } from './money-text';

export interface LedgerRow {
  label: string;
  value: Rupiah;
  op?: 'minus';
}

/** Rincian rumus: baris angka rata kanan, pengurang diawali −, total tebal di bawah garis. */
export function LedgerColumn({
  rows,
  total,
  totalLabel = 'Total',
}: {
  rows: LedgerRow[];
  total: Rupiah;
  totalLabel?: string;
}) {
  return (
    <table className="w-full border-collapse text-base">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td className="w-6 py-1.5 text-text-muted">
              {row.op === 'minus' ? (
                <>
                  <span aria-hidden="true">{'−'}</span>
                  <span className="sr-only">dikurangi</span>
                </>
              ) : null}
            </td>
            <th scope="row" className="py-1.5 text-left font-normal text-text-muted">
              {row.label}
            </th>
            <td className="py-1.5 text-right">
              <MoneyText value={row.value} />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-border">
          <td />
          <th scope="row" className="pt-2 text-left font-bold text-text">
            {totalLabel}
          </th>
          <td className="pt-2 text-right">
            <MoneyText value={total} className="font-bold" />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
