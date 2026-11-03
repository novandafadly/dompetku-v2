'use client';

import type { DemoState, Entry } from '@dompetku/demo-data';
import type { Route } from 'next';
import { entryToVM } from './demo-vm';
import { EntryRowView } from './entry-row-view';
import { accountName } from './filters';

export function entryWallet(state: DemoState, entry: Entry): string {
  return entry.kind === 'transfer' && entry.counterAccountId !== undefined
    ? `${accountName(state, entry.accountId)} → ${accountName(state, entry.counterAccountId)}`
    : accountName(state, entry.accountId);
}

/** Pembungkus demo: entri demo → `EntryVM` → `EntryRowView` (markup sama dengan mode nyata). */
export function EntryRow({ state, entry, href }: { state: DemoState; entry: Entry; href: Route }) {
  return (
    <EntryRowView
      entry={entryToVM(state, entry)}
      href={href}
      reimburse={entry.kind === 'expense' && entry.reimbursable === true}
    />
  );
}
