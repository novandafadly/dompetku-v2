'use client';

import { balances } from '@dompetku/demo-data';
import type { Route } from 'next';
import type { AccountVM } from '@/features/ledger/types';
import { AccountListView } from './account-list-view';
import { AddWalletButton } from './add-wallet-button';
import type { DompetContext } from './context';

/** Pembungkus prototipe: saldo demo dihitung (`balances`) lalu diserahkan ke view ber-VM. */
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
  const accounts: AccountVM[] = state.accounts
    .filter((a) => a.ruang === ruang)
    .map((a) => ({
      id: a.id,
      name: a.name,
      pocket: a.pocket,
      walletType: a.walletType,
      openedOn: a.openedOn,
      archived: false,
      balance: bal.get(a.id) ?? 0,
    }));
  return (
    <AccountListView
      ruang={ruang}
      accounts={accounts}
      accountHref={accountHref}
      renderAdd={(className) => <AddWalletButton onAdd={onAdd} className={className} />}
    />
  );
}
