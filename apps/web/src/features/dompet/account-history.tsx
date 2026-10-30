'use client';

import { CaretLeftIcon } from '@phosphor-icons/react';
import { balances, entryTitle, groupByDay, signedAmount } from '@dompetku/demo-data';
import type { Account, AmountKind, DemoState, Entry } from '@dompetku/demo-data';
import type { Route } from 'next';
import Link from 'next/link';
import { useId } from 'react';
import { MoneyText } from '@/components/ui/money-text';
import { focusRing } from '@/components/ui/styles';
import { EmptyState } from '@/components/ui/state';
import { POCKET_LABEL, WALLET_TYPE_LABEL, type DompetContext } from './context';

function categoryName(state: DemoState, e: Entry): string | null {
  if (e.kind !== 'income' && e.kind !== 'expense') return null;
  return state.categories.find((c) => c.id === e.categoryId)?.name ?? null;
}

/** Efek entri pada dompet ini: transfer keluar mengurangi, transfer masuk menambah. */
function effect(e: Entry, accountId: string): { value: number; kind: AmountKind } {
  if (e.kind === 'transfer') {
    return { value: e.accountId === accountId ? -e.amount : e.amount, kind: 'neutral' };
  }
  return signedAmount(e);
}

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
  const baseId = useId();
  const balance = balances(state, ruang).get(account.id) ?? 0;
  const entries = state.entries.filter(
    (e) => e.ruang === ruang && (e.accountId === account.id || e.counterAccountId === account.id),
  );
  const groups = groupByDay(entries, today);
  return (
    <div>
      <Link
        href={dompetHref}
        className={`-ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-base text-accent underline ${focusRing}`}
      >
        <CaretLeftIcon size={20} aria-hidden="true" />
        Dompet
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-text">{account.name}</h1>
      <p className="text-sm text-text-muted">
        {POCKET_LABEL[account.pocket]} · {WALLET_TYPE_LABEL[account.walletType]}
        {account.pocket === 'kantor' ? ' · Tidak masuk hitungan pribadi' : ''}
      </p>
      <p className="mt-3 text-sm text-text-muted">Saldo</p>
      <p data-testid="wallet-balance">
        <MoneyText value={balance} size="hero" />
      </p>
      {groups.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Belum ada transaksi di dompet ini." />
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.date} aria-labelledby={`${baseId}-${g.date}`} className="mt-6">
            <h2
              id={`${baseId}-${g.date}`}
              className="border-b border-text pb-1 text-base font-semibold text-text"
            >
              {g.label}
            </h2>
            <ul aria-label={`Riwayat ${g.label}`}>
              {g.items.map((e) => {
                const { value, kind } = effect(e, account.id);
                const category = categoryName(state, e);
                return (
                  <li key={e.id} className="border-b border-hairline last:border-b-0">
                    <Link
                      href={entryHref(e.id)}
                      className={`flex min-h-15 items-center justify-between gap-3 py-2 ${focusRing}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-base break-words text-text">
                          {entryTitle(state, e)}
                        </span>
                        {category !== null && e.description !== undefined ? (
                          <span className="block text-sm break-words text-text-muted">
                            {category}
                          </span>
                        ) : null}
                      </span>
                      {/* Spasi di DOM agar teks terbaca "Saldo awal Rp 4.100.000". */}{' '}
                      <MoneyText value={value} kind={kind} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
