import { daysInclusive, type IsoDate } from '@dompetku/domain';
import type { Route } from 'next';
import type { ComponentProps } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { WarningIcon } from '@/components/ui/icons/warning';
import { ErrorState } from '@/components/ui/state';
import type { EntryVM, Ruang } from '@/features/ledger/types';
import { EntryDetailView } from '@/features/transaksi/entry-detail-view';
import { VOIDED_COPY, VoidedBanner } from '@/features/transaksi/voided-banner';
import type { DetailData } from '@/server/ledger/detail';
import { DetailActionsIsland, RestoreIsland } from './detail-islands';
import { RetryIsland } from './transaksi-islands';

/** Saldo awal hanya bisa diubah (nominalnya saja) ≤ 7 hari sejak dompet dibuka (BSD §9.1). */
const OPENING_EDIT_DAYS = 7;

/**
 * Yang boleh dilakukan pada entri ini di mode nyata S6, sesuai `api.update_entry`/`void_entry`:
 * - Ubah: pemasukan/pengeluaran; saldo awal hanya nominal dan ≤ 7 hari. Transfer, cocokkan saldo,
 *   dan antar ruang ditolak `api.update_entry` (`kind_not_editable`): tanpa tombol Ubah.
 * - Batalkan: semua entri hidup kecuali saldo awal (`opening_locked`) dan antar ruang (S7).
 * "Pindahkan ke ruang lain" tidak dirender di mode nyata (S7).
 */
export function detailAbilities(
  entry: EntryVM,
  data: Pick<DetailData, 'accounts'>,
  today: IsoDate,
): { editable: boolean; voidable: boolean } {
  if (entry.voidedAt !== undefined) return { editable: false, voidable: false };
  if (entry.kind === 'opening_balance') {
    const opened = data.accounts.find((a) => a.id === entry.accountId)?.openedOn;
    const editable = opened !== undefined && daysInclusive(opened, today) - 1 <= OPENING_EDIT_DAYS;
    return { editable, voidable: false };
  }
  return {
    editable: entry.kind === 'income' || entry.kind === 'expense',
    voidable: entry.kind !== 'space_transfer',
  };
}

/**
 * Detail transaksi mode nyata (Server Component): `EntryDetailView` dirender di server dari data
 * ruang ini saja; aksi (Ubah, Batalkan, Pulihkan) adalah pulau klien yang dimuat malas, dan sheet
 * Ubah serta dialog Batalkan baru dimuat saat dipakai. Entri batal = banner S6-D3, bukan 404.
 */
export function DetailReal({
  ruang,
  today,
  me,
  listHref,
  data,
  labels,
}: {
  ruang: Ruang;
  today: IsoDate;
  /** Id pengguna sekarang ("Dicatat oleh kamu", konflik dari tab sendiri). */
  me: string;
  listHref: Route;
  data: DetailData;
  /**
   * Judul, label kategori, nominal bertanda (`detailLabels` dari `features/ledger/present`,
   * dihitung page di server). Diterima jadi agar modul ini (juga dipakai galeri klien) tidak
   * menjadi importir kedua `present.ts` (ADR 0002, lihat `EntryDetailView`).
   */
  labels: Pick<ComponentProps<typeof EntryDetailView>, 'title' | 'category' | 'amount'>;
}) {
  const { entry, accounts, categories } = data;
  const voidedAt = entry.voidedAt;
  const { editable, voidable } = detailAbilities(entry, data, today);
  const by = entry.createdBy.id === me ? 'kamu' : entry.createdBy.name;

  const banner =
    voidedAt === undefined ? null : (
      <VoidedBanner>
        {data.restoreClosed ? (
          <p className="flex items-center gap-1.5 text-meta font-semibold text-warning">
            <WarningIcon size={16} weight="fill" className="shrink-0" />
            {VOIDED_COPY.closed}
          </p>
        ) : (
          <RestoreIsland ruang={ruang} entry={entry} accounts={accounts} />
        )}
      </VoidedBanner>
    );

  return (
    <EntryDetailView
      entry={entry}
      title={labels.title}
      category={labels.category}
      amount={labels.amount}
      ruang={ruang}
      by={by}
      today={today}
      listHref={listHref}
      banner={banner}
      struck={voidedAt !== undefined}
      actions={
        editable || voidable ? (
          <DetailActionsIsland
            ruang={ruang}
            entry={entry}
            accounts={accounts}
            categories={categories}
            today={today}
            me={me}
            listHref={listHref}
            editable={editable}
            voidable={voidable}
          />
        ) : null
      }
    />
  );
}

/** Gagal muat (galat loader ditangkap page): salinan tetap + Coba lagi (`router.refresh`). */
export function DetailFailed({ listHref }: { listHref: Route }) {
  return (
    <article className="flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6">
      <BackLink href={listHref}>Transaksi</BackLink>
      <ErrorState
        title="Transaksi belum bisa dimuat."
        description="Periksa koneksi lalu coba lagi."
        actions={<RetryIsland />}
      />
    </article>
  );
}
