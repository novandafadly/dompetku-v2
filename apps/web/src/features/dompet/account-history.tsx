'use client';

import {
  balances,
  entryCategoryName,
  entryKindLabel,
  entryTitle,
  groupByDay,
  signedAmount,
} from '@dompetku/demo-data';
import type { Account, AmountKind, DemoState, Entry } from '@dompetku/demo-data';
import type { Route } from 'next';
import { useId, useState, type ReactNode } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { CategoryIcon, WalletTypeIcon } from '@/components/ui/category-icon';
import { ArrowDownIcon } from '@/components/ui/icons/arrow-down';
import { FlagIcon } from '@/components/ui/icons/flag';
import { ListBulletsIcon } from '@/components/ui/icons/list-bullets';
import { MoneyText } from '@/components/ui/money-text';
import { TxRow } from '@/components/ui/rows';
import { EmptyState } from '@/components/ui/state';
import { card, heroCard, tile } from '@/components/ui/styles';
import { POCKET_LABEL, WALLET_TYPE_LABEL, type DompetContext } from './context';

const PAGE = 50;

/** Efek entri pada dompet ini: transfer keluar mengurangi, transfer masuk menambah. */
function effect(e: Entry, accountId: string): { value: number; kind: AmountKind } {
  if (e.kind === 'transfer') {
    return { value: e.accountId === accountId ? -e.amount : e.amount, kind: 'neutral' };
  }
  return signedAmount(e);
}

function GroupList({
  id,
  label,
  total,
  children,
}: {
  id: string;
  label: string;
  total?: number;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2
        id={id}
        className="flex items-baseline justify-between gap-3 px-1 text-meta font-bold text-text-soft"
      >
        <span>{label}</span>
        {total === undefined ? null : <MoneyText value={total} size="inherit" />}
      </h2>
      <ul aria-label={`Riwayat ${label}`} className={`px-4 ${card}`}>
        {children}
      </ul>
    </section>
  );
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
  const [limit, setLimit] = useState(PAGE);
  const balance = balances(state, ruang).get(account.id) ?? 0;
  const mine = state.entries.filter(
    (e) => e.ruang === ruang && (e.accountId === account.id || e.counterAccountId === account.id),
  );
  // Entri pembuka selalu di paling bawah riwayat, terpisah dari transaksi harian.
  const opening = mine.filter((e) => e.kind === 'opening_balance' && e.voidedAt === undefined);
  const daily = mine.filter((e) => e.kind !== 'opening_balance');
  let left = limit;
  const groups = [];
  for (const g of groupByDay(daily, today)) {
    if (left <= 0) break;
    groups.push({ ...g, shown: g.items.slice(0, left) });
    left -= g.items.length;
  }
  const row = (e: Entry, s: DemoState) => {
    const { value, kind } = effect(e, account.id);
    return (
      <TxRow
        key={e.id}
        href={entryHref(e.id)}
        icon={<CategoryIcon name={entryCategoryName(s, e)} kind={e.kind} size={20} />}
        label={entryTitle(s, e)}
        meta={`${entryKindLabel(s, e)} · ${account.name}`}
        value={value}
        kind={kind}
      />
    );
  };

  return (
    <div className="flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6">
      <BackLink href={dompetHref}>Dompet</BackLink>
      <section className={`flex flex-col gap-3 p-4 ${heroCard}`}>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className={`size-12 ${tile}`}>
            <WalletTypeIcon type={account.walletType} size={24} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="text-headline font-extrabold break-words text-text">{account.name}</h1>
            <p className="text-label font-medium text-text-muted">
              {POCKET_LABEL[account.pocket]} · {WALLET_TYPE_LABEL[account.walletType]}
              {account.pocket === 'kantor' ? ' · Tidak masuk hitungan pribadi' : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-label font-medium text-text-soft">Saldo</p>
          <p data-testid="wallet-balance">
            <MoneyText value={balance} size="inherit" className="text-amount-sm font-extrabold" />
          </p>
        </div>
      </section>
      {daily.length === 0 && opening.length === 0 ? (
        <EmptyState
          icon={<ListBulletsIcon size={26} />}
          title="Belum ada transaksi di dompet ini."
        />
      ) : null}
      {groups.map((g) => (
        <GroupList
          key={g.date}
          id={`${baseId}-${g.date}`}
          label={g.label}
          total={g.shown.reduce((sum, e) => sum + effect(e, account.id).value, 0)}
        >
          {g.shown.map((e) => row(e, state))}
        </GroupList>
      ))}
      {daily.length > limit ? (
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
      ) : null}
      {opening.length === 0 ? null : (
        <GroupList id={`${baseId}-pembuka`} label="Entri pembuka">
          {opening.map((e) => (
            <TxRow
              key={e.id}
              href={entryHref(e.id)}
              icon={<FlagIcon size={20} />}
              label="Saldo awal"
              value={e.amount}
              kind="neutral"
            />
          ))}
        </GroupList>
      )}
    </div>
  );
}
