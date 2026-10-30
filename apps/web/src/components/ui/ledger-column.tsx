import type { Rupiah } from '@dompetku/domain';
import { MoneyText } from './money-text';

export interface LedgerRow {
  label: string;
  value: Rupiah;
  op?: 'minus';
}

/** Kolom buku kas: baris angka rata kanan, garis ganda di atas total. */
export function LedgerColumn({ rows, total }: { rows: LedgerRow[]; total: Rupiah }) {
  return (
    <table className="w-full border-collapse text-base">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td className="w-6 py-1 text-text-muted">
              {row.op === 'minus' ? (
                <>
                  <span aria-hidden="true">{'−'}</span>
                  <span className="sr-only">dikurangi</span>
                </>
              ) : null}
            </td>
            <th scope="row" className="py-1 text-left font-normal text-text">
              {row.label}
            </th>
            <td className="py-1 text-right">
              <MoneyText value={row.value} />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-4 border-double border-text">
          <td />
          <th scope="row" className="pt-2 text-left font-semibold text-text">
            Total
          </th>
          <td className="pt-2 text-right">
            <MoneyText value={total} className="font-semibold" />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
