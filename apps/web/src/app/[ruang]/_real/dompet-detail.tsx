import { type IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import { BackLink } from '@/components/ui/back-link';
import { buttonClass } from '@/components/ui/button';
import { ArrowDownIcon } from '@/components/ui/icons/arrow-down';
import { ErrorState } from '@/components/ui/state';
import { focusRing } from '@/components/ui/styles';
import { ArchiveBlockedCard } from '@/features/dompet/archive-blocked-card';
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
import type { Ruang } from '@/features/ledger/types';
import { buildEntryHref } from '@/features/shell/hrefs';
import type { DompetRiwayat } from '@/server/ledger/dompet';
import { ArchiveIsland, ReconcileIsland } from './dompet-actions-islands';
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
}: {
  ruang: Ruang;
  today: IsoDate;
  query: string;
  dompetHref: Route;
  /** Alamat halaman berikutnya; `null` bila semua entri sudah tampil. */
  moreHref: Route | null;
  data: DompetRiwayat;
}) {
  const { account } = data;
  const openingEntry = openingEntryOf(data, today);
  const effect = (e: (typeof data.entries)[number]) => effectOnAccountVM(e, account.id);
  const groups: HistoryGroup[] = groupByDayVM(data.entries, today).map((g) => ({
    key: g.date,
    label: g.label,
    total: g.entries.reduce((sum, e) => sum + effect(e).value, 0),
    rows: g.entries.map((e): HistoryRow => {
      const { value, kind } = effect(e);
      const feeNote = accountFeeNoteVM(e, account.id);
      return {
        id: e.id,
        href: buildEntryHref(ruang, e.id, query),
        iconName: e.categoryName,
        entryKind: e.kind,
        label: entryTitleVM(e),
        meta: `${entryKindLabelVM(e)} · ${
          e.kind === 'transfer' && e.counterAccountName !== undefined
            ? `${e.accountName} → ${e.counterAccountName}`
            : account.name
        }`,
        ...(feeNote === undefined
          ? {}
          : { status: <span className="text-meta font-semibold text-text-muted">{feeNote}</span> }),
        value,
        kind,
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
      actions={
        account.archived ? null : (
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
        )
      }
      footer={
        account.archived ? (
          <p className="text-meta font-medium text-text-muted">
            Dompet ini sudah diarsipkan. Riwayatnya tetap bisa dilihat.
          </p>
        ) : account.balance === 0 ? (
          <ArchiveIsland
            ruang={ruang}
            account={{ id: account.id, name: account.name }}
            dompetHref={dompetHref}
          />
        ) : (
          <ArchiveBlockedCard name={account.name} />
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
