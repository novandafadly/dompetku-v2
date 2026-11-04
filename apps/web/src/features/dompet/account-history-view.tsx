import type { Rupiah } from '@dompetku/domain';
import type { Route } from 'next';
import { useId, type ReactNode } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { CategoryIcon, WalletTypeIcon } from '@/components/ui/category-icon';
import { FlagIcon } from '@/components/ui/icons/flag';
import { ListBulletsIcon } from '@/components/ui/icons/list-bullets';
import { MoneyText, type MoneyKind } from '@/components/ui/money-text';
import { TxRow } from '@/components/ui/rows';
import { EmptyState } from '@/components/ui/state';
import { card, heroCard, tile } from '@/components/ui/styles';
import type { Pocket, WalletType } from '@/features/ledger/types';
import { POCKET_LABEL, WALLET_TYPE_LABEL } from './context';

/** Satu baris riwayat dompet; teks dan nominal sudah jadi (dihitung pemanggil dari efek pada dompet ini). */
export interface HistoryRow {
  id: string;
  href: Route;
  /** Nama kategori (pemetaan ikon) dan jenis entri (ikon entri tanpa kategori). */
  iconName?: string | undefined;
  entryKind: string;
  label: string;
  meta: string;
  value: Rupiah;
  kind: MoneyKind;
}

/** Satu hari: label relatif, jumlah efek hari itu pada dompet ini, baris terbaru di atas. */
export interface HistoryGroup {
  key: string;
  label: string;
  total: Rupiah;
  rows: HistoryRow[];
}

function GroupList({
  id,
  label,
  total,
  children,
}: {
  id: string;
  label: string;
  total?: Rupiah;
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

/**
 * Riwayat satu dompet dari baris yang sudah jadi, untuk kedua mode: mode nyata merendernya di
 * server (data dompet ini saja); pembungkus demo (`AccountHistory`) menghitung barisnya dari data
 * demo. "Muat lagi" diberikan pemanggil (`more`): tombol state di prototipe, tautan di mode nyata.
 */
export function AccountHistoryView({
  account,
  groups,
  opening,
  dompetHref,
  more,
  actions,
  footer,
}: {
  account: { name: string; pocket: Pocket; walletType: WalletType; balance: Rupiah };
  groups: HistoryGroup[];
  /** Entri pembuka (Saldo awal), selalu di paling bawah, terpisah dari transaksi harian. */
  opening: Pick<HistoryRow, 'id' | 'href' | 'value'>[];
  dompetHref: Route;
  more?: ReactNode;
  /** Di kepala dompet, di bawah saldo (mode nyata: Cocokkan saldo, Ubah saldo awal; S7-W1/W2). */
  actions?: ReactNode;
  /** Di paling bawah halaman (mode nyata: arsip dompet, S7-W3). */
  footer?: ReactNode;
}) {
  const baseId = useId();
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
            <MoneyText value={account.balance} size="amount-sm" />
          </p>
        </div>
        {actions}
      </section>
      {groups.length === 0 && opening.length === 0 ? (
        <EmptyState
          icon={<ListBulletsIcon size={26} />}
          title="Belum ada transaksi di dompet ini."
        />
      ) : null}
      {groups.map((g) => (
        <GroupList key={g.key} id={`${baseId}-${g.key}`} label={g.label} total={g.total}>
          {g.rows.map((r) => (
            <TxRow
              key={r.id}
              href={r.href}
              icon={<CategoryIcon name={r.iconName} kind={r.entryKind} size={20} />}
              label={r.label}
              meta={r.meta}
              value={r.value}
              kind={r.kind}
            />
          ))}
        </GroupList>
      ))}
      {more}
      {opening.length === 0 ? null : (
        <GroupList id={`${baseId}-pembuka`} label="Entri pembuka">
          {opening.map((r) => (
            <TxRow
              key={r.id}
              href={r.href}
              icon={<FlagIcon size={20} />}
              label="Saldo awal"
              value={r.value}
              kind="neutral"
            />
          ))}
        </GroupList>
      )}
      {footer}
    </div>
  );
}
