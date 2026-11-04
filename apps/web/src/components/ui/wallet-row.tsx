import type { Rupiah } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CaretRightIcon } from './icons/caret-right';
import { MoneyText } from './money-text';
import { rowSub } from './row-text';
import { rowDivider, rowLink, tile } from './styles';

// Satu berkas per jenis baris: rute hanya memuat baris yang dipakainya (ADR 0002).

/**
 * Dompet: ubin ikon tipe, nama, tipe, saldo, caret; seluruh baris tautan ke riwayat. Di bawah
 * 360 px saldo turun ke baris kedua kolom teks (grid; urutan DOM tetap) agar nama 40 karakter
 * dengan saldo `Rp 12.345.678.900` tidak terperas ke kolom 20 px. Nama paling banyak 2 baris.
 */
export function WalletRow({
  href,
  icon,
  name,
  type,
  balance,
}: {
  href: Route;
  icon: ReactNode;
  name: string;
  type: string;
  balance: Rupiah;
}) {
  return (
    <li className={rowDivider}>
      <Link
        href={href}
        className={`${rowLink} max-narrow:grid max-narrow:grid-cols-tile-text-caret max-narrow:items-center max-narrow:gap-y-0.75`}
      >
        <span aria-hidden="true" className={`size-10 ${tile} max-narrow:row-span-2`}>
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.75">
          <span
            title={name}
            className="line-clamp-2 text-body/tight font-semibold break-words text-text"
          >
            {name}
          </span>
          <span className={rowSub}>{type}</span>
        </span>{' '}
        <span className="max-narrow:col-start-2 max-narrow:row-start-2 max-narrow:justify-self-start">
          <MoneyText value={balance} />
        </span>
        <CaretRightIcon
          size={16}
          weight="bold"
          className="shrink-0 text-text-muted max-narrow:col-start-3 max-narrow:row-span-2 max-narrow:row-start-1"
        />
      </Link>
    </li>
  );
}
