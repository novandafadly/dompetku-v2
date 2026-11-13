import { formatRupiah, type Rupiah } from '@dompetku/domain';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';

/**
 * Kolom buku kas (ui-ux R4; S11): tabel dua kolom, angka rata kanan tabular, baris pengurang
 * bertanda `−`, garis ganda di atas hasil. Server-safe, tanpa JS; markup mengikuti rincian
 * `SafeToSpendCard` (`caption` sr-only, `th scope="row"`, `tfoot`). Tanpa warna merah/hijau:
 * tanda dibawa teks. Pemanggil memberi angka; di sini tidak ada penjumlahan.
 */

export interface KolomKasRow {
  label: string;
  value: Rupiah;
  /** `true`: tampil bertanda (`+Rp …` / `−Rp …`); selain itu angka polos. */
  signed?: boolean;
  /** Sisa utang: bernilai 0 tampil `Lunas` (ikon + teks), tidak pernah `Rp 0` (bingkai aturan 3). */
  lunas?: boolean;
}

/** Nilai satu sel: `Lunas` untuk sisa utang 0, selain itu rupiah. */
function Amount({
  value,
  signed,
  lunas,
}: {
  value: Rupiah;
  signed?: boolean | undefined;
  lunas?: boolean | undefined;
}) {
  if (lunas === true && value === 0) {
    return (
      <span className="inline-flex items-center gap-1 font-bold text-accent-text">
        <CheckCircleIcon size={16} weight="fill" className="shrink-0" />
        Lunas
      </span>
    );
  }
  return <>{formatRupiah(value, signed === true ? { sign: 'always' } : {})}</>;
}

const CELL = 'py-1.5 text-label align-top';

export function KolomKas({
  caption,
  rows,
  result,
  title,
  className = '',
}: {
  /** Nama tabel untuk pembaca layar. */
  caption: string;
  rows: readonly KolomKasRow[];
  /** Baris hasil di bawah garis ganda; tanpa ini tabel hanya daftar dua kolom. */
  result?: { label: string; value: Rupiah; lunas?: boolean };
  /** Judul terlihat 13/700 di atas tabel (dialog dengan dua kolom). */
  title?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {title === undefined ? null : (
        <p aria-hidden="true" className="pb-0.5 text-meta font-bold text-text">
          {title}
        </p>
      )}
      <table className="w-full border-collapse">
        <caption className="sr-only">{caption}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className={`${CELL} pr-3 text-left font-medium text-text-soft`}>
                {r.label}
              </th>
              <td className={`${CELL} num text-right font-medium whitespace-nowrap text-text`}>
                <Amount value={r.value} signed={r.signed} lunas={r.lunas} />
              </td>
            </tr>
          ))}
        </tbody>
        {result === undefined ? null : (
          <tfoot>
            <tr className="border-t-3 border-double border-border">
              <th scope="row" className={`${CELL} pr-3 text-left font-extrabold text-text`}>
                {result.label}
              </th>
              <td className={`${CELL} num text-right font-extrabold whitespace-nowrap text-text`}>
                <Amount value={result.value} lunas={result.lunas} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
