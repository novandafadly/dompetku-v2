import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CaretLeftIcon } from './icons/caret-left';
import { focusRing } from './styles';

/** Tautan kembali 44 px berwarna accent-text: "‹ Transaksi", "‹ Dompet", "‹ Beranda". */
export function BackLink({ href, children }: { href: Route; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`-ml-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-md px-1 text-body font-bold text-accent-text hover-pointer:underline ${focusRing}`}
    >
      <CaretLeftIcon size={16} weight="bold" />
      {children}
    </Link>
  );
}
