import { type IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import { BackLink } from '@/components/ui/back-link';
import { buttonClass } from '@/components/ui/button';
import { ArrowDownIcon } from '@/components/ui/icons/arrow-down';
import { ErrorState } from '@/components/ui/state';
import { card } from '@/components/ui/styles';
import { CardError } from '@/features/bersama/card-error';
import { focusRing } from '@/components/ui/styles';
import { ArchiveBlockedCard } from '@/features/dompet/archive-blocked-card';
import { ModalCard } from '@/features/dompet/modal-card';
import {
  AccountHistoryView,
  type HistoryGroup,
  type HistoryRow,
} from '@/features/dompet/account-history-view';
import { groupByDayVM } from '@/features/ledger/group-by-day';
import { openingEditable } from '@/features/ledger/opening';
import {
  accountFeeNoteVM,
  effectOnAccountVM,
  entryKindLabelVM,
  entryTitleVM,
} from '@/features/ledger/present';
import { AssetKindIcon } from '@/features/aset/asset-icon';
import { ASET_COPY as AC, ASSET_KIND_LABEL } from '@/features/aset/copy';
import { SAHAM_COPY as SC } from '@/features/saham/copy';
import type { StockOverviewVM } from '@/features/saham/types';
import type {
  AccountVM,
  AssetOverviewVM,
  EntryVM,
  Ruang,
  TradingAccountVM,
} from '@/features/ledger/types';
import { shortDateLabel } from '@dompetku/domain';
import { buildAccountHref, buildEntryHref } from '@/features/shell/hrefs';
import { buildGoalListHref } from '@/features/tujuan/hrefs';
import type { GoalVM } from '@/features/tujuan/types';
import type { DompetRiwayat } from '@/server/ledger/dompet';
import { AssetTransferIsland, RevalueIsland } from './aset-islands';
import {
  StockActions,
  StockBalance,
  StockLoadFailed,
  StockSection,
  stockScope,
} from './dompet-saham';
import { ArchiveIsland, ReconcileIsland } from './dompet-actions-islands';
import { DompetGoalCard } from './dompet-goal';
import { ModalActionsIsland } from './trading-islands';
import { RetryIsland } from './transaksi-islands';

/** Entri per halaman riwayat dompet; "Muat lagi" menambah sebanyak ini (`?tampil=`). */
export const HISTORY_PAGE = 50;

/**
 * Entri saldo awal dompet ini dan apakah masih bisa diubah (≤ 7 hari sejak dompet dibuka, aturan DB
 * `opening_locked`); `null` bila dompet tanpa entri saldo awal (dibuat tanpa saldo).
 */
export function openingEntryOf(
  data: DompetRiwayat,
  today: IsoDate,
): { id: string; editable: boolean } | null {
  const first = data.opening[0];
  if (first === undefined) return null;
  return { id: first.id, editable: openingEditable(data.account.openedOn, today) };
}

/**
 * Transfer ke/dari dompet trading ini dengan dompet non-trading = setor/tarik modal (S12-TR3,
 * definisi K2); antar dua dompet trading bukan. Dompet lawan yang tidak ada di daftar (terarsip)
 * dianggap biasa.
 */
function modalMoveOf(
  e: EntryVM,
  accountId: string,
  byId: ReadonlyMap<string, AccountVM>,
): { kind: string; label: string } | null {
  // Beli/jual saham dilabeli dari trade-nya (`entryTitleVM`: `Beli {kode} · {n} lembar`), bukan setor/tarik.
  if (e.kind !== 'transfer' || e.trade !== undefined) return null;
  // Lawan trading atau dompet saham (K7: beli/jual saham tidak menggeser modal) bukan setor/tarik.
  const internal = (a: AccountVM | undefined) =>
    a?.pocket === 'trading' || a?.assetKind === 'saham';
  if (e.counterAccountId === accountId) {
    return internal(byId.get(e.accountId))
      ? null
      : { kind: 'Setor modal', label: `Setor modal dari ${e.accountName}` };
  }
  if (e.accountId === accountId && e.counterAccountId !== undefined) {
    return internal(byId.get(e.counterAccountId))
      ? null
      : { kind: 'Tarik modal', label: `Tarik modal ke ${e.counterAccountName ?? ''}` };
  }
  return null;
}

/**
 * Transfer ke/dari aset ini = `Isi dari …` / `Cair ke …` (S14-AS3). Entri trade saham (satu-satunya
 * yang menyentuh dompet saham, dijaga DB) dilabeli `entryTitleVM` dari trade-nya, bukan di sini.
 */
function assetMoveOf(e: EntryVM, accountId: string): { kind: string; label: string } | null {
  if (e.trade !== undefined) return null;
  if (e.kind === 'valuation') {
    return { kind: e.direction === 'out' ? 'Turun' : 'Naik', label: AC.valuationLabel };
  }
  if (e.kind !== 'transfer') return null;
  if (e.counterAccountId === accountId) return { kind: 'Isi', label: `Isi dari ${e.accountName}` };
  if (e.accountId === accountId && e.counterAccountId !== undefined) {
    return { kind: 'Cair', label: `Cair ke ${e.counterAccountName ?? ''}` };
  }
  return null;
}

/** Baris di bawah nama aset: `Emas · diperbarui 14 Nov` atau `Emas · nilai sejak 1 Nov` (S14-AS3). */
function assetSubtitle(
  kind: keyof typeof ASSET_KIND_LABEL,
  overview: AssetOverviewVM | null,
  openedOn: IsoDate,
): string {
  const label = ASSET_KIND_LABEL[kind];
  if (kind === 'saham') return label;
  if (overview === null) return label;
  return overview.lastValuedOn === null
    ? AC.kindSince(label, shortDateLabel(openedOn))
    : AC.kindUpdated(label, shortDateLabel(overview.lastValuedOn));
}

/**
 * Riwayat dompet mode nyata (Server Component): entri yang menyentuh dompet ini, dikelompokkan per
 * hari; jumlah dan nominal per baris = efek pada dompet ini. Saldo dari `account_balances`.
 * Data ruang ini saja; "Muat lagi" = tautan ke halaman yang sama dengan `?tampil=` lebih besar.
 */
export function DompetDetailReal({
  ruang,
  today,
  query,
  dompetHref,
  moreHref,
  data,
  accounts = [],
  trading,
  goal,
  asset,
  stock,
}: {
  ruang: Ruang;
  today: IsoDate;
  query: string;
  dompetHref: Route;
  /** Alamat halaman berikutnya; `null` bila semua entri sudah tampil. */
  moreHref: Route | null;
  data: DompetRiwayat;
  /** Dompet ruang ini: sisi lawan setor/tarik modal (hanya dipakai dompet trading). */
  accounts?: AccountVM[];
  /** Hanya dompet trading: angka modal dompet ini, atau `error` bila gagal dimuat. */
  trading?: TradingAccountVM | 'error' | null;
  /**
   * Hanya dompet tabungan aktif (S13-TJ9): tujuan aktifnya (`goal: null` = belum ada) dan nama
   * anggota lain, atau `error` bila gagal dimuat. `undefined` = dompet lain (tidak ditampilkan apa pun).
   */
  goal?: { goal: GoalVM | null; partnerName: string | null } | 'error';
  /** Hanya dompet aset (S14): ringkasannya dari `api.asset_overview`, atau `error` bila gagal dimuat. */
  asset?: AssetOverviewVM | 'error' | null;
  /** Hanya dompet saham aktif (S14-SH1): posisi per kode dari `api.stock_overview`, atau `error`. */
  stock?: StockOverviewVM | 'error';
}) {
  const { account } = data;
  const isTrading = account.pocket === 'trading';
  const isAsset = account.pocket === 'aset' && account.assetKind !== undefined;
  const isStock = isAsset && account.assetKind === 'saham';
  const overview = typeof asset === 'object' && asset !== null ? asset : null;
  const stockData = typeof stock === 'object' ? stock : null;
  const scope =
    isStock && stockData !== null
      ? stockScope({
          ruang,
          today,
          account: { id: account.id, name: account.name, openedOn: account.openedOn },
          accounts,
          overview: stockData,
        })
      : null;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const openingEntry = openingEntryOf(data, today);
  const effect = (e: (typeof data.entries)[number]) => effectOnAccountVM(e, account.id);
  const groups: HistoryGroup[] = groupByDayVM(data.entries, today).map((g) => ({
    key: g.date,
    label: g.label,
    total: g.entries.reduce((sum, e) => sum + effect(e).value, 0),
    rows: g.entries.map((e): HistoryRow => {
      const { value, kind } = effect(e);
      const feeNote = accountFeeNoteVM(e, account.id);
      const modalMove = isTrading ? modalMoveOf(e, account.id, byId) : null;
      const assetMove = isAsset ? assetMoveOf(e, account.id) : null;
      const move = modalMove ?? assetMove;
      return {
        id: e.id,
        href: buildEntryHref(ruang, e.id, query),
        iconName: e.categoryName,
        entryKind: e.kind,
        // Setor/tarik modal (S12-TR3): keterangan pengguna tetap menang atas label bawaan.
        label: move === null ? entryTitleVM(e) : (e.description ?? move.label),
        meta: `${move === null ? entryKindLabelVM(e) : move.kind} · ${
          e.kind === 'transfer' && e.counterAccountName !== undefined
            ? `${e.accountName} → ${e.counterAccountName}`
            : account.name
        }`,
        ...(feeNote === undefined
          ? {}
          : { status: <span className="text-meta font-semibold text-text-muted">{feeNote}</span> }),
        value,
        kind,
        ...(e.kind === 'valuation' ? { signed: true } : {}),
      };
    }),
  }));

  return (
    <AccountHistoryView
      account={account}
      groups={groups}
      opening={data.opening.map((e) => ({
        id: e.id,
        href: buildEntryHref(ruang, e.id, query),
        value: e.amount,
      }))}
      dompetHref={dompetHref}
      heroIcon={
        isAsset && account.assetKind !== undefined ? (
          <AssetKindIcon kind={account.assetKind} size={24} />
        ) : undefined
      }
      subtitle={
        isAsset && account.assetKind !== undefined
          ? assetSubtitle(account.assetKind, overview, account.openedOn)
          : undefined
      }
      balanceLabel={
        isStock
          ? stockData === null
            ? SC.costOf(account.name)
            : SC.marketOf(account.name)
          : isAsset
            ? AC.valueOf(account.name)
            : undefined
      }
      balanceNode={
        isStock && stockData !== null ? (
          <StockBalance overview={stockData} />
        ) : isAsset && account.balance === 0 ? (
          <span className="text-body font-semibold text-text-soft">
            {isStock ? AC.noValueStock : AC.noValue}
          </span>
        ) : undefined
      }
      openingLabel={isAsset ? AC.openingLabel : undefined}
      actions={
        account.archived ? null : isAsset ? (
          isStock ? (
            scope === null ? null : (
              <StockActions scope={scope} />
            )
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <RevalueIsland
                  ruang={ruang}
                  today={today}
                  asset={{
                    id: account.id,
                    name: account.name,
                    balance: account.balance,
                    lastOn: overview?.lastValuedOn ?? null,
                  }}
                />
                <AssetTransferIsland
                  ruang={ruang}
                  today={today}
                  account={{ id: account.id, name: account.name, balance: account.balance }}
                  accounts={accounts}
                />
              </div>
              {openingEntry?.editable === true ? (
                <Link
                  href={buildEntryHref(ruang, openingEntry.id, query)}
                  aria-label={`${AC.editOpening} ${account.name}`}
                  className={`inline-flex min-h-11 items-center self-start rounded-md text-meta font-bold text-accent-text hover-pointer:underline ${focusRing}`}
                >
                  {AC.editOpening}
                </Link>
              ) : null}
              <p className="text-caption font-medium text-text-muted">{AC.notIncome}</p>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-3">
            {isTrading ? (
              <ModalActionsIsland
                ruang={ruang}
                today={today}
                account={{ id: account.id, name: account.name, balance: account.balance }}
                capitalLeft={
                  typeof trading === 'object' && trading !== null ? trading.capitalLeft : 0
                }
                accounts={accounts}
              />
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <ReconcileIsland
                ruang={ruang}
                account={{ id: account.id, name: account.name, balance: account.balance }}
              />
              {openingEntry?.editable === true ? (
                <Link
                  href={buildEntryHref(ruang, openingEntry.id, query)}
                  aria-label={`Ubah saldo awal ${account.name}`}
                  className={`inline-flex min-h-11 items-center rounded-md text-meta font-bold text-accent-text hover-pointer:underline ${focusRing}`}
                >
                  Ubah saldo awal
                </Link>
              ) : null}
            </div>
            {isTrading ? (
              <p className="text-caption font-medium text-text-muted">
                Untung atau rugi dicatat lewat Cocokkan saldo, bukan pemasukan.
              </p>
            ) : null}
          </div>
        )
      }
      afterHero={
        isStock ? (
          stock === 'error' ? (
            <StockLoadFailed retryHref={buildAccountHref(ruang, account.id, query)} />
          ) : scope === null || stockData === null ? null : (
            <StockSection scope={scope} overview={stockData} />
          )
        ) : goal !== undefined ? (
          goal === 'error' ? (
            <section aria-label="Tujuan" className={`px-4 pt-3 ${card}`}>
              <CardError
                message="Tujuan belum bisa dimuat."
                retryHref={buildAccountHref(ruang, account.id, query)}
              />
            </section>
          ) : (
            <DompetGoalCard
              ruang={ruang}
              query={query}
              today={today}
              account={{ id: account.id, name: account.name, balance: account.balance }}
              goal={goal.goal}
              partnerName={goal.partnerName}
            />
          )
        ) : !isTrading || trading === undefined || trading === null ? null : trading === 'error' ? (
          <section aria-label="Modal" className={`px-4 pt-3 ${card}`}>
            <CardError
              message="Modal trading belum bisa dimuat."
              retryHref={buildAccountHref(ruang, account.id, query)}
            />
          </section>
        ) : (
          <ModalCard variant="detail" figures={trading} />
        )
      }
      footer={
        account.archived ? (
          <p className="text-meta font-medium text-text-muted">
            {isAsset ? 'Aset' : 'Dompet'} ini sudah diarsipkan. Riwayatnya tetap bisa dilihat.
          </p>
        ) : account.balance === 0 && !(typeof goal === 'object' && goal.goal !== null) ? (
          <ArchiveIsland
            ruang={ruang}
            account={{ id: account.id, name: account.name }}
            dompetHref={dompetHref}
            asset={isAsset}
          />
        ) : (
          <ArchiveBlockedCard
            name={account.name}
            {...(isAsset
              ? {
                  text: isStock
                    ? AC.archiveBlockedStock(account.name)
                    : AC.archiveBlocked(account.name),
                }
              : {})}
            {...(isStock && stockData?.holdings.some((h) => h.shares > 0) === true
              ? { stock: { href: '#saham', label: SC.viewStock } }
              : {})}
            {...(account.balance === 0 && typeof goal === 'object' && goal.goal !== null
              ? { goal: { name: goal.goal.name, href: buildGoalListHref(ruang, query) } }
              : {})}
          />
        )
      }
      more={
        moreHref === null ? null : (
          <Link
            href={moreHref}
            scroll={false}
            prefetch={false}
            className={buttonClass('secondary', 'md', 'w-full')}
          >
            <ArrowDownIcon size={18} weight="bold" />
            Muat lagi
          </Link>
        )
      }
    />
  );
}

/** Gagal muat (galat loader ditangkap page): salinan tetap + Coba lagi (`router.refresh`). */
export function DompetDetailFailed({ dompetHref }: { dompetHref: Route }) {
  return (
    <div className="flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6">
      <BackLink href={dompetHref}>Dompet</BackLink>
      <ErrorState
        title="Riwayat dompet belum bisa dimuat."
        description="Periksa koneksi lalu coba lagi."
        actions={<RetryIsland />}
      />
    </div>
  );
}
