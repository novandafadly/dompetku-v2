'use client';

import { entryCategoryName, entryKindLabel, entryTitle, signedAmount } from '@dompetku/demo-data';
import type { DemoState, Entry } from '@dompetku/demo-data';
import type { Route } from 'next';
import { CategoryIcon } from '@/components/ui/category-icon';
import { ClockIcon } from '@/components/ui/icons/clock';
import { TxRow } from '@/components/ui/rows';
import { accountName } from './filters';

export function entryWallet(state: DemoState, entry: Entry): string {
  return entry.kind === 'transfer' && entry.counterAccountId !== undefined
    ? `${accountName(state, entry.accountId)} → ${accountName(state, entry.counterAccountId)}`
    : accountName(state, entry.accountId);
}

export function EntryRow({ state, entry, href }: { state: DemoState; entry: Entry; href: Route }) {
  const { value, kind } = signedAmount(entry);
  return (
    <TxRow
      href={href}
      icon={<CategoryIcon name={entryCategoryName(state, entry)} kind={entry.kind} size={20} />}
      label={entryTitle(state, entry)}
      meta={`${entryKindLabel(state, entry)} · ${entryWallet(state, entry)}`}
      status={
        entry.kind === 'expense' && entry.reimbursable === true ? (
          <span className="flex items-center gap-1 text-meta font-semibold text-warning">
            <ClockIcon size={14} className="shrink-0" />
            Menunggu reimburse
          </span>
        ) : undefined
      }
      value={value}
      kind={kind}
    />
  );
}
