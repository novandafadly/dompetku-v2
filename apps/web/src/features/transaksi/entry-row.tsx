'use client';

import { ClockIcon } from '@phosphor-icons/react';
import { entryTitle, signedAmount } from '@dompetku/demo-data';
import type { DemoState, Entry } from '@dompetku/demo-data';
import type { Route } from 'next';
import Link from 'next/link';
import { MoneyText } from '@/components/ui/money-text';
import { focusRing } from '@/components/ui/styles';
import { accountName, entryCategoryName } from './filters';

export function entryKindLabel(state: DemoState, e: Entry): string {
  switch (e.kind) {
    case 'opening_balance':
      return 'Saldo awal';
    case 'transfer':
      return 'Pindah dompet';
    case 'space_transfer':
      return 'Antar ruang';
    default:
      return entryCategoryName(state, e) ?? 'Tanpa kategori';
  }
}

export function EntryRow({ state, entry, href }: { state: DemoState; entry: Entry; href: Route }) {
  const { value, kind } = signedAmount(entry);
  const wallet =
    entry.kind === 'transfer' && entry.counterAccountId !== undefined
      ? `${accountName(state, entry.accountId)} → ${accountName(state, entry.counterAccountId)}`
      : accountName(state, entry.accountId);
  return (
    <li className="border-b border-hairline last:border-b-0">
      <Link
        href={href}
        className={`flex min-h-15 items-center justify-between gap-3 py-2 ${focusRing}`}
      >
        <span className="min-w-0">
          <span className="block text-base break-words text-text">{entryTitle(state, entry)}</span>
          <span className="block text-sm break-words text-text-muted">
            {entryKindLabel(state, entry)} · {wallet}
          </span>
          {entry.kind === 'expense' && entry.reimbursable === true ? (
            <span className="mt-0.5 flex items-center gap-1 text-sm text-warning">
              <ClockIcon size={16} aria-hidden="true" className="shrink-0" />
              Menunggu reimburse
            </span>
          ) : null}
        </span>
        <MoneyText value={value} kind={kind} />
      </Link>
    </li>
  );
}
