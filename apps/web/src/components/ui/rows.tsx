import { formatRupiah, type Rupiah } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { MoneyText, type MoneyKind } from './money-text';
import { rowSub, rowTitle } from './row-text';
import { rowDivider, rowLink, tile } from './styles';

// Baris lain ada di bill-row, budget-row, activity-row, wallet-row: satu berkas per jenis baris
// supaya rute hanya memuat baris yang dipakainya (ADR 0002).

/** Baris transaksi (≥ 62): ubin ikon kategori, keterangan (ellipsis), sub, nominal. Seluruh baris tautan ke detail. */
export function TxRow({
  href,
  icon,
  label,
  meta,
  status,
  value,
  kind,
}: {
  href: Route;
  icon: ReactNode;
  label: string;
  meta?: string;
  /** Status tambahan (ikon + teks), mis. Menunggu reimburse. */
  status?: ReactNode;
  value: Rupiah;
  kind: MoneyKind;
}) {
  // Nominal sangat panjang (> 13 karakter, ambang yang sama dengan MoneyText) di bawah 360 px:
  // turun ke baris kedua kolom teks agar keterangan tidak terperas jadi "Bel…" (grid; DOM tetap).
  const long = formatRupiah(value, kind === 'income' ? { sign: 'always' } : {}).length > 13;
  return (
    <li className={rowDivider}>
      <Link
        href={href}
        className={`${rowLink} ${long ? 'max-narrow:grid max-narrow:grid-cols-tile-text max-narrow:items-center max-narrow:gap-y-0.75' : ''}`}
      >
        <span
          aria-hidden="true"
          className={`size-10 ${tile} ${long ? 'max-narrow:row-span-2' : ''}`}
        >
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.75">
          <span title={label} className={rowTitle}>
            {label}
          </span>
          {meta === undefined ? null : <span className={rowSub}>{meta}</span>}
          {status}
        </span>
        {/* Spasi di DOM agar teks baris terbaca utuh oleh pembaca layar. */}{' '}
        <span className={long ? 'max-narrow:col-start-2 max-narrow:justify-self-start' : ''}>
          <MoneyText value={value} kind={kind} />
        </span>
      </Link>
    </li>
  );
}
