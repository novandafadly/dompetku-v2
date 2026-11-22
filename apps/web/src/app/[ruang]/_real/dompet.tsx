import type { IsoDate } from '@dompetku/domain';
import { ErrorState } from '@/components/ui/state';
import { card } from '@/components/ui/styles';
import { CardError } from '@/features/bersama/card-error';
import { AccountListView } from '@/features/dompet/account-list-view';
import { ArchivedAccounts } from '@/features/dompet/archived-accounts';
import { ModalCard } from '@/features/dompet/modal-card';
import { waitingItems, WaitingReimburseList } from '@/features/dompet/reimburse-list';
import { AssetKindIcon } from '@/features/aset/asset-icon';
import { ASET_COPY, ASSET_KIND_LABEL } from '@/features/aset/copy';
import { NetWorthHero } from './net-worth-hero';
import { MoneyText } from '@/components/ui/money-text';
import type {
  AccountVM,
  AssetOverviewVM,
  NetWorthVM,
  ReimbursableVM,
  Ruang,
  TradingOverviewVM,
} from '@/features/ledger/types';
import { GoalLine } from '@/features/tujuan/goal-line';
import type { GoalLineVM } from '@/features/tujuan/types';
import { buildAccountHref, buildEntryHref, buildHref } from '@/features/shell/hrefs';
import { PageHeader } from '@/features/shell/page-header';
import { AddAssetHostIsland, AddAssetTriggerIsland } from './aset-islands';
import { AddWalletHostIsland, AddWalletTriggerIsland } from './dompet-islands';
import { RetryIsland } from './transaksi-islands';

/**
 * Dompet mode nyata (Server Component): daftar dari `account_balances` ruang ini saja (`AccountVM`,
 * saldo dari VM). Tambah dompet = pulau klien (sheet dimuat malas; `?tambah=1` membukanya).
 * S7: kartu Menunggu reimburse di atas kelompok dompet (Pribadi saja, W4) dan kartu Diarsipkan
 * di bawah (W3). Cocokkan saldo dan arsip ada di riwayat dompet. S12: kelompok Trading dan kartu
 * Modal trading (Pribadi saja; angka dari `api.trading_overview`).
 */
export function DompetReal({
  ruang,
  query,
  today,
  accounts,
  reimbursables,
  archived,
  trading,
  goalLines = {},
  netWorth,
  assets = [],
}: {
  ruang: Ruang;
  /** Query yang dibawa tautan (mode nyata: hanya `theme`), '' atau '?a=b'. */
  query: string;
  today: IsoDate;
  accounts: AccountVM[];
  /** Talangan terbuka; hanya dipakai di Pribadi (Bersama tidak punya talangan). */
  reimbursables: ReimbursableVM[];
  archived: AccountVM[];
  /** Hanya Pribadi dengan dompet trading aktif: angka modal, atau `error` bila gagal dimuat. */
  trading?: TradingOverviewVM | 'error' | null;
  /** Tujuan aktif per id dompet tabungan (S13-TJ10); menggantikan baris tipe dompet itu. */
  goalLines?: Readonly<Record<string, GoalLineVM>>;
  /** Kekayaan bersih dari `api.net_worth` (S14-NW1), atau `error` bila gagal dimuat. */
  netWorth: NetWorthVM | 'error';
  /** Dompet aset aktif dari `api.asset_overview`; hanya nilai pasar dompet saham yang dipakai di sini. */
  assets?: readonly AssetOverviewVM[];
}) {
  const accountHref = (id: string) => buildAccountHref(ruang, id, query);
  // Bersama tidak pernah menampilkan talangan, apa pun yang diterima (page juga tidak memuatnya).
  const waiting = ruang === 'pribadi' ? reimbursables : [];
  const modal =
    ruang !== 'pribadi' || trading === undefined || trading === null ? undefined : trading ===
      'error' ? (
      <section aria-label="Modal trading" className={`px-4 pt-3 ${card}`}>
        <CardError
          message="Modal trading belum bisa dimuat."
          retryHref={buildHref(ruang, 'dompet', query)}
        />
      </section>
    ) : (
      <ModalCard variant="overview" figures={trading.total} />
    );
  const names = [...accounts, ...archived].map((a) => a.name);
  const overviewOf = (id: string) => assets.find((o) => o.accountId === id);
  // Baris aset (S14-AS1): ikon jenis, label jenis, dan nilai; saham memakai nilai pasar dari SQL.
  const assetSub = (a: AccountVM) => {
    if (a.assetKind === undefined) return undefined;
    const o = overviewOf(a.id);
    if (a.assetKind === 'saham' && o?.marketValue !== null && o !== undefined) {
      // Kalimat jujur harga tidak boleh terpotong elipsis (`rowSub` truncate): boleh membungkus.
      if ((o.missingPriceCount ?? 0) > 0)
        return (
          <span data-testid="stock-row-sub" className="whitespace-normal">
            {`${ASSET_KIND_LABEL.saham} · sebagian belum ada harga`}
          </span>
        );
      return a.balance === 0 ? ASSET_KIND_LABEL.saham : `${ASSET_KIND_LABEL.saham} · nilai pasar`;
    }
    return ASSET_KIND_LABEL[a.assetKind];
  };
  const assetValue = (a: AccountVM) => {
    if (a.assetKind === undefined) return undefined;
    const o = overviewOf(a.id);
    if (a.assetKind === 'saham') {
      if (a.balance === 0) return <Muted>{ASET_COPY.noValueStock}</Muted>;
      return o?.marketValue == null ? undefined : <MoneyText value={o.marketValue} />;
    }
    return a.balance === 0 ? <Muted>{ASET_COPY.noValue}</Muted> : undefined;
  };
  return (
    <AddWalletHostIsland ruang={ruang} existingNames={accounts.map((a) => a.name)}>
      <AddAssetHostIsland ruang={ruang} today={today} query={query} existingNames={names}>
        <PageHeader
          title="Dompet"
          action={
            <div className="flex items-center gap-2">
              <AddWalletTriggerIsland />
              <AddAssetTriggerIsland variant="secondary" />
            </div>
          }
        />
        <AccountListView
          ruang={ruang}
          accounts={accounts}
          accountHref={accountHref}
          hero={
            <NetWorthHero
              ruang={ruang}
              today={today}
              netWorth={netWorth}
              retryHref={buildHref(ruang, 'dompet', query)}
            />
          }
          renderAddAsset={(className) => <AddAssetTriggerIsland className={className} />}
          walletIcon={(a) =>
            a.assetKind === undefined ? undefined : <AssetKindIcon kind={a.assetKind} />
          }
          walletValue={assetValue}
          renderAdd={(className) => <AddWalletTriggerIsland className={className} />}
          above={
            <WaitingReimburseList
              items={waitingItems(waiting, [...accounts, ...archived], today, (id) =>
                buildEntryHref(ruang, id, query),
              )}
              total={waiting.reduce((sum, r) => sum + r.remaining, 0)}
            />
          }
          below={<ArchivedAccounts accounts={archived} accountHref={accountHref} />}
          modal={modal}
          walletSub={(a) => {
            if (a.pocket === 'aset') return assetSub(a);
            const line = goalLines[a.id];
            return line === undefined ? undefined : <GoalLine goal={line} />;
          }}
        />
      </AddAssetHostIsland>
    </AddWalletHostIsland>
  );
}

function Muted({ children }: { children: string }) {
  return <span className="text-label font-medium text-text-muted">{children}</span>;
}

/** Gagal muat (galat loader ditangkap page): salinan tetap + Coba lagi (`router.refresh`). */
export function DompetFailed() {
  return (
    <>
      <PageHeader title="Dompet" />
      <div className="laptop:max-w-180">
        <ErrorState
          title="Dompet belum bisa dimuat."
          description="Periksa koneksi lalu coba lagi."
          actions={<RetryIsland />}
        />
      </div>
    </>
  );
}
