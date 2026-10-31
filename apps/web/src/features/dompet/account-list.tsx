'use client';

import { balances } from '@dompetku/demo-data';
import type { Account, Pocket } from '@dompetku/demo-data';
import type { Route } from 'next';
import { Button } from '@/components/ui/button';
import { WalletTypeIcon } from '@/components/ui/category-icon';
import { InfoIcon } from '@/components/ui/icons/info';
import { PlusIcon } from '@/components/ui/icons/plus';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { ListCard } from '@/components/ui/list-card';
import { MoneyText } from '@/components/ui/money-text';
import { WalletRow } from '@/components/ui/rows';
import { SpaceTag } from '@/components/ui/space-tag';
import { EmptyState } from '@/components/ui/state';
import { heroCard } from '@/components/ui/styles';
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
  const subtotal = accounts.reduce((sum, a) => sum + balanceOf(a.id), 0);
  return (
    <ListCard
      title={POCKET_LABEL[pocket]}
      aside={
        <MoneyText
          value={subtotal}
          size="inherit"
          className="text-label font-bold text-text-soft"
        />
      }
      note={
        pocket === 'kantor' ? (
          <p className="flex items-center gap-1.5 text-caption font-semibold text-warning">
            <InfoIcon size={14} weight="fill" className="shrink-0" />
            Tidak masuk hitungan pribadi
          </p>
        ) : undefined
      }
    >
      <ul>
        {accounts.map((a) => (
          <WalletRow
            key={a.id}
            href={accountHref(a.id)}
            icon={<WalletTypeIcon type={a.walletType} size={20} />}
            name={a.name}
            type={WALLET_TYPE_LABEL[a.walletType]}
            balance={balanceOf(a.id)}
          />
        ))}
      </ul>
    </ListCard>
  );
}

export function AddWalletButton({
  onAdd,
  className = '',
}: {
  onAdd: () => void;
  className?: string;
}) {
  return (
    <Button variant="secondary" onClick={onAdd} className={className}>
      <PlusIcon size={18} weight="bold" />
      Tambah dompet
    </Button>
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
  // Tombol tambah di HP/tablet ada di isi; laptop memakai tombol di header halaman.
  const add = <AddWalletButton onAdd={onAdd} className="w-full laptop:hidden" />;

  if (mine.length === 0) {
    return (
      <div className="flex flex-col gap-3 laptop:max-w-180">
        <EmptyState
          icon={<WalletIcon size={26} />}
          title={`Belum ada dompet di ${RUANG_NAME[ruang]}.`}
          description="Tambah dompet yang kamu pakai sehari-hari untuk mulai mencatat."
          action={<AddWalletButton onAdd={onAdd} />}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 tablet:gap-4 laptop:max-w-250 laptop:gap-5">
      <section
        aria-labelledby="kekayaan"
        className={`flex flex-col gap-2 p-4 laptop:p-6 ${heroCard}`}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id="kekayaan" className="text-label font-semibold text-text-soft">
            Kekayaan bersih
          </h2>
          <SpaceTag space={ruang} />
        </div>
        <p data-testid="net-worth">
          <MoneyText value={netWorth} size="amount" className="laptop:text-display-lg" />
        </p>
        <p className="text-meta font-medium text-text-soft">
          {ruang === 'pribadi'
            ? 'Operasional + tabungan. Kas Kantor tidak dihitung.'
            : 'Operasional + tabungan.'}
        </p>
      </section>
      {add}
      <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2 tablet:gap-4 laptop:grid-cols-3 laptop:items-start laptop:gap-5">
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
  );
}
