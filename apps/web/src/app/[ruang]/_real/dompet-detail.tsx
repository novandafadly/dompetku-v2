import { type IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import { BackLink } from '@/components/ui/back-link';
import { buttonClass } from '@/components/ui/button';
import { ArrowDownIcon } from '@/components/ui/icons/arrow-down';
import { ErrorState } from '@/components/ui/state';
import {
  AccountHistoryView,
  type HistoryGroup,
  type HistoryRow,
} from '@/features/dompet/account-history-view';
import { groupByDayVM } from '@/features/ledger/group-by-day';
import { effectOnAccountVM, entryKindLabelVM, entryTitleVM } from '@/features/ledger/present';
import type { Ruang } from '@/features/ledger/types';
import { buildEntryHref } from '@/features/shell/hrefs';
import type { DompetRiwayat } from '@/server/ledger/dompet';
import { RetryIsland } from './transaksi-islands';

/** Entri per halaman riwayat dompet; "Muat lagi" menambah sebanyak ini (`?tampil=`). */
export const HISTORY_PAGE = 50;

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
  const effect = (e: (typeof data.entries)[number]) => effectOnAccountVM(e, account.id);
  const groups: HistoryGroup[] = groupByDayVM(data.entries, today).map((g) => ({
    key: g.date,
    label: g.label,
    total: g.entries.reduce((sum, e) => sum + effect(e).value, 0),
    rows: g.entries.map((e): HistoryRow => {
      const { value, kind } = effect(e);
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
