import type { Rupiah } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CaretRightIcon } from './icons/caret-right';
import { MoneyText } from './money-text';
import { rowSub } from './row-text';
import { rowDivider, rowLink, tile } from './styles';

// Satu berkas per jenis baris: rute hanya memuat baris yang dipakainya (ADR 0002).

/** Dompet: ubin ikon tipe, nama, tipe, saldo, caret; seluruh baris tautan ke riwayat. */
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
      <Link href={href} className={rowLink}>
        <span aria-hidden="true" className={`size-10 ${tile}`}>
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.75">
          <span className="block text-body/tight font-semibold break-words text-text">{name}</span>
          <span className={rowSub}>{type}</span>
        </span>{' '}
        <MoneyText value={balance} />
        <CaretRightIcon size={16} weight="bold" className="shrink-0 text-text-muted" />
      </Link>
    </li>
  );
}
