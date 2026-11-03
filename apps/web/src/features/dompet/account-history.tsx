'use client';

import {
  balances,
  entryCategoryName,
  entryKindLabel,
  entryTitle,
  groupByDay,
  signedAmount,
} from '@dompetku/demo-data';
import type { Account, AmountKind, Entry } from '@dompetku/demo-data';
import type { Route } from 'next';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowDownIcon } from '@/components/ui/icons/arrow-down';
import { AccountHistoryView, type HistoryGroup, type HistoryRow } from './account-history-view';
import type { DompetContext } from './context';

const PAGE = 50;

/** Efek entri pada dompet ini: transfer keluar mengurangi, transfer masuk menambah. */
function effect(e: Entry, accountId: string): { value: number; kind: AmountKind } {
  if (e.kind === 'transfer') {
    return { value: e.accountId === accountId ? -e.amount : e.amount, kind: 'neutral' };
  }
  return signedAmount(e);
}

/** Pembungkus prototipe: baris riwayat dihitung dari data demo, lalu diserahkan ke view. */
export function AccountHistory({
  state,
  ruang,
  today,
  account,
  dompetHref,
  entryHref,
}: Pick<DompetContext, 'state' | 'ruang' | 'today'> & {
  account: Account;
  dompetHref: Route;
  entryHref: (id: string) => Route;
}) {
  const [limit, setLimit] = useState(PAGE);
  const balance = balances(state, ruang).get(account.id) ?? 0;
  const mine = state.entries.filter(
    (e) => e.ruang === ruang && (e.accountId === account.id || e.counterAccountId === account.id),
  );
  // Entri pembuka selalu di paling bawah riwayat, terpisah dari transaksi harian.
  const opening = mine.filter((e) => e.kind === 'opening_balance' && e.voidedAt === undefined);
  const daily = mine.filter((e) => e.kind !== 'opening_balance');
  let left = limit;
  const groups: HistoryGroup[] = [];
  for (const g of groupByDay(daily, today)) {
    if (left <= 0) break;
    const shown = g.items.slice(0, left);
    left -= g.items.length;
    const rows: HistoryRow[] = shown.map((e) => {
      const { value, kind } = effect(e, account.id);
      return {
        id: e.id,
        href: entryHref(e.id),
        iconName: entryCategoryName(state, e),
        entryKind: e.kind,
        label: entryTitle(state, e),
        meta: `${entryKindLabel(state, e)} · ${account.name}`,
        value,
        kind,
      };
    });
    groups.push({
      key: g.date,
      label: g.label,
      total: shown.reduce((sum, e) => sum + effect(e, account.id).value, 0),
      rows,
    });
  }

  return (
    <AccountHistoryView
      account={{
        name: account.name,
        pocket: account.pocket,
        walletType: account.walletType,
        balance,
      }}
      groups={groups}
      opening={opening.map((e) => ({ id: e.id, href: entryHref(e.id), value: e.amount }))}
      dompetHref={dompetHref}
      more={
        daily.length > limit ? (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              setLimit((l) => l + PAGE);
            }}
          >
            <ArrowDownIcon size={18} weight="bold" />
            Muat lagi
          </Button>
        ) : null
      }
    />
  );
}
