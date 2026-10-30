'use client';

import { PlusIcon } from '@phosphor-icons/react';
import { balances } from '@dompetku/demo-data';
import type { Account, Pocket } from '@dompetku/demo-data';
import type { Route } from 'next';
import Link from 'next/link';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { MoneyText } from '@/components/ui/money-text';
import { focusRing } from '@/components/ui/styles';
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
    <section aria-labelledby={labelId} className="mt-6">
      <div className="flex items-baseline justify-between gap-3 border-b border-text pb-1">
        <h2 id={labelId} className="text-base font-semibold text-text">
          {POCKET_LABEL[pocket]}
        </h2>
        <MoneyText value={subtotal} />
      </div>
      <ul>
        {accounts.map((a) => (
          <li key={a.id} className="border-b border-hairline last:border-b-0">
            <Link
              href={accountHref(a.id)}
              className={`flex min-h-15 items-center justify-between gap-3 py-2 ${focusRing}`}
            >
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
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-semibold text-text">Dompet {RUANG_NAME[ruang]}</h1>
        <Button variant="secondary" onClick={onAdd}>
          <PlusIcon size={20} aria-hidden="true" />
          Tambah dompet
        </Button>
      </div>
      {mine.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={`Belum ada dompet di ${RUANG_NAME[ruang]}.`}
            description="Tambah dompet yang kamu pakai sehari-hari untuk mulai mencatat."
          />
        </div>
      ) : (
        <>
          <section aria-label="Kekayaan bersih" className="mt-4">
            <p className="text-sm text-text-muted">Kekayaan bersih</p>
            <p data-testid="net-worth" className="mt-1">
              <MoneyText value={netWorth} size="hero" />
            </p>
            <p className="mt-1 text-sm text-text-muted">Operasional dan tabungan.</p>
          </section>
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
        </>
      )}
    </div>
  );
}
