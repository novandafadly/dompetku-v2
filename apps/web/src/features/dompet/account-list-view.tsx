import type { Route } from 'next';
import type { ReactNode } from 'react';
import { WalletTypeIcon } from '@/components/ui/category-icon';
import { ChartLineUpIcon } from '@/components/ui/icons/chart-line-up';
import { InfoIcon } from '@/components/ui/icons/info';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { ListCard } from '@/components/ui/list-card';
import { MoneyText } from '@/components/ui/money-text';
import { SpaceTag } from '@/components/ui/space-tag';
import { EmptyState } from '@/components/ui/state';
import { heroCard } from '@/components/ui/styles';
import { WalletRow } from '@/components/ui/wallet-row';
import type { AccountVM, Pocket, Ruang } from '@/features/ledger/types';
import { POCKET_LABEL, RUANG_NAME, WALLET_TYPE_LABEL } from './context';

const POCKETS: Pocket[] = ['operasional', 'tabungan', 'trading', 'kantor'];

function Group({
  pocket,
  accounts,
  accountHref,
}: {
  pocket: Pocket;
  accounts: AccountVM[];
  accountHref: (id: string) => Route;
}) {
  const subtotal = accounts.reduce((sum, a) => sum + a.balance, 0);
  return (
    <ListCard
      title={POCKET_LABEL[pocket]}
      icon={pocket === 'trading' ? <ChartLineUpIcon size={18} /> : undefined}
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
            balance={a.balance}
          />
        ))}
      </ul>
    </ListCard>
  );
}

/**
 * Daftar Dompet dari `AccountVM` untuk kedua mode (saldo dari VM, bukan dihitung ulang): mode nyata
 * merendernya di server dari `account_balances`; pembungkus demo (`AccountList`) memetakan data
 * demo ke VM lebih dulu. Tombol Tambah dompet diberikan pemanggil (`renderAdd`): prototipe memakai
 * state klien, mode nyata pulau klien.
 */
export function AccountListView({
  ruang,
  accounts,
  accountHref,
  renderAdd,
  above,
  below,
  modal,
}: {
  ruang: Ruang;
  accounts: AccountVM[];
  accountHref: (id: string) => Route;
  /** Tombol Tambah dompet; `className` mengatur tata letaknya (HP/tablet di isi, laptop di header). */
  renderAdd: (className: string) => ReactNode;
  /** Kartu di atas kelompok dompet (mode nyata: Menunggu reimburse, S7-W4). */
  above?: ReactNode;
  /** Kartu di paling bawah (mode nyata: Diarsipkan, S7-W3). */
  below?: ReactNode;
  /** Kartu tepat di bawah kelompok Trading (mode nyata, Pribadi: Modal trading, S12-TR2). */
  modal?: ReactNode;
}) {
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-3 laptop:max-w-180">
        <EmptyState
          icon={<WalletIcon size={26} />}
          title={`Belum ada dompet di ${RUANG_NAME[ruang]}.`}
          description="Tambah dompet yang kamu pakai sehari-hari untuk mulai mencatat."
          action={renderAdd('')}
        />
        {above}
        {below}
      </div>
    );
  }
  // Trading ikut (aset pengguna, S12); Kantor tidak; dompet sistem Patungan tidak pernah dompet.
  const netWorth = accounts
    .filter((a) => a.pocket !== 'kantor' && a.pocket !== 'patungan')
    .reduce((sum, a) => sum + a.balance, 0);

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
            ? accounts.some((a) => a.pocket === 'trading')
              ? 'Operasional, tabungan, dan trading. Kas Kantor tidak dihitung.'
              : 'Operasional + tabungan. Kas Kantor tidak dihitung.'
            : 'Operasional + tabungan.'}
        </p>
      </section>
      {/* Tombol tambah di HP/tablet ada di isi; laptop memakai tombol di header halaman. */}
      {renderAdd('w-full laptop:hidden')}
      {above}
      <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2 tablet:gap-4 laptop:grid-cols-3 laptop:items-start laptop:gap-5">
        {POCKETS.map((pocket) => {
          const inPocket = accounts.filter((a) => a.pocket === pocket);
          if (inPocket.length === 0) return null;
          const group = (
            <Group key={pocket} pocket={pocket} accounts={inPocket} accountHref={accountHref} />
          );
          // Kartu Modal ikut kolom kelompok Trading (urutan DOM: kelompok lalu kartu).
          return pocket === 'trading' && modal !== undefined ? (
            <div key={pocket} className="flex flex-col gap-3 tablet:gap-4 laptop:gap-5">
              {group}
              {modal}
            </div>
          ) : (
            group
          );
        })}
      </div>
      {below}
    </div>
  );
}
