'use client';

import { PlusIcon } from '@phosphor-icons/react';
import { balances } from '@dompetku/demo-data';
import type { Account, Pocket } from '@dompetku/demo-data';
import type { Route } from 'next';
import Link from 'next/link';
import { useId } from 'react';
import { BalanceCard } from '@/components/ui/balance-card';
import { Button } from '@/components/ui/button';
import { MoneyText } from '@/components/ui/money-text';
import { focusRing, listBlock, listRow, rowLink } from '@/components/ui/styles';
import { EmptyState } from '@/components/ui/state';
import { POCKET_LABEL, RUANG_NAME, WALLET_TYPE_LABEL, type DompetContext } from './context';

const POCKETS: Pocket[] = ['operasional', 'tabungan', 'kantor'];

function Group({
  pocket,
  accounts,
  balanceOf,
  accountHref,
}: {
  pocket: Pocket;
  accounts: Account[];
  balanceOf: (id: string) => number;
  accountHref: (id: string) => Route;
}) {
  const labelId = useId();
  const subtotal = accounts.reduce((sum, a) => sum + balanceOf(a.id), 0);
  return (
    <section aria-labelledby={labelId}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={labelId} className="text-lg font-semibold text-text">
          {POCKET_LABEL[pocket]}
        </h2>
        <MoneyText value={subtotal} />
      </div>
      <ul className={listBlock}>
        {accounts.map((a) => (
          <li key={a.id} className={listRow}>
            <Link href={accountHref(a.id)} className={`${rowLink} ${focusRing}`}>
              <span className="min-w-0">
                <span className="block text-base break-words text-text">{a.name}</span>
                <span className="block text-sm text-text-muted">
                  {WALLET_TYPE_LABEL[a.walletType]}
                  {pocket === 'kantor' ? ' · Tidak masuk hitungan pribadi' : ''}
                </span>
              </span>
              <MoneyText value={balanceOf(a.id)} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AccountList({
  state,
  ruang,
  accountHref,
  onAdd,
}: Pick<DompetContext, 'state' | 'ruang'> & {
  accountHref: (id: string) => Route;
  onAdd: () => void;
}) {
  const bal = balances(state, ruang);
  const balanceOf = (id: string) => bal.get(id) ?? 0;
  const mine = state.accounts.filter((a) => a.ruang === ruang);
  const netWorth = mine
    .filter((a) => a.pocket !== 'kantor')
    .reduce((sum, a) => sum + balanceOf(a.id), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-text">Dompet {RUANG_NAME[ruang]}</h1>
        <Button variant="secondary" onClick={onAdd}>
          <PlusIcon size={20} aria-hidden="true" className="shrink-0" />
          Tambah dompet
        </Button>
      </div>
      {mine.length === 0 ? (
        <div className="mx-auto mt-6 max-w-2xl">
          <EmptyState
            title={`Belum ada dompet di ${RUANG_NAME[ruang]}.`}
            description="Tambah dompet yang kamu pakai sehari-hari untuk mulai mencatat."
          />
        </div>
      ) : (
        // Tiga keadaan: satu kolom (< 768), grup berpasangan (768-1023),
        // kartu | grup (>= 1024, spec R12).
        <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:items-start">
          <BalanceCard aria-label="Kekayaan bersih">
            <p className="text-base font-semibold text-text">Kekayaan bersih</p>
            <p data-testid="net-worth" className="mt-2">
              <MoneyText value={netWorth} size="hero" />
            </p>
            <p className="mt-2 text-sm text-text-muted">Operasional dan tabungan.</p>
          </BalanceCard>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-1">
            {POCKETS.map((pocket) => {
              const accounts = mine.filter((a) => a.pocket === pocket);
              return accounts.length === 0 ? null : (
                <Group
                  key={pocket}
                  pocket={pocket}
                  accounts={accounts}
                  balanceOf={balanceOf}
                  accountHref={accountHref}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
