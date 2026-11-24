import type { IsoDate } from '@dompetku/domain';
import { BackLink } from '@/components/ui/back-link';
import { ErrorState, LoadingRegion, Skeleton } from '@/components/ui/state';
import type { TripDetailData } from '@/features/ledger/trip-types';
import type { Ruang } from '@/features/ledger/types';
import { buildEntryHref } from '@/features/shell/hrefs';
import { buildTripListHref } from '@/features/shell/trip-hrefs';
import { TRIP_COPY as C } from '@/features/trip/copy';
import {
  TripArchivedBanner,
  TripBreakdownCard,
  TripBudgetCard,
  TripCandidatesCard,
  TripEntriesCard,
  TripHero,
} from '@/features/trip/trip-detail-views';
import { RetryIsland } from './transaksi-islands';
import {
  AddTripBudgetIsland,
  ArchiveTripIsland,
  EditTripIsland,
  ImportEntriesIsland,
  RemoveTripEntryIsland,
  TripDetailHostIsland,
} from './trip-detail-islands';
import { TRIP_DETAIL_TITLE_ID, TRIP_ENTRIES_HEADING_ID } from './trip-ids';
import { RestoreTripIsland } from './trip-islands';

/**
 * Halaman Detail trip mode nyata (Server Component; S15-TR5..TR10).
 * Urutan DOM = fokus = baca: BackLink → (terarsip: banner) → hero → anggaran → kartu Masukkan →
 * rincian (Per kategori, Per hari, Dicatat oleh) → Pengeluaran.
 */

const WIDTH = 'flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6';

export function TripDetailReal({
  ruang,
  today,
  data,
  partnerName,
}: {
  ruang: Ruang;
  today: IsoDate;
  data: TripDetailData;
  /** Nama anggota lain di Bersama dua anggota (dialog Arsipkan); `null` untuk Pribadi/solo. */
  partnerName: string | null;
}) {
  const { trip, breakdown, candidates, candidatesMore, entries, entriesTruncated, memberCount } =
    data;
  // Indeks id baris berikutnya untuk memindahkan fokus sesudah `Keluarkan` (TR8).
  const nextIdOf = new Map<string, string | null>();
  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i];
    if (cur === undefined) continue;
    nextIdOf.set(cur.id, entries[i + 1]?.id ?? entries[i - 1]?.id ?? null);
  }

  return (
    <TripDetailHostIsland
      ruang={ruang}
      today={today}
      trip={trip}
      candidates={candidates}
      partnerName={partnerName}
    >
      <article className={WIDTH}>
        <BackLink href={buildTripListHref(ruang, '')}>{C.title}</BackLink>
        {trip.archived ? (
          <TripArchivedBanner
            restore={
              <RestoreTripIsland
                ruang={ruang}
                tripId={trip.id}
                name={trip.name}
                variant="banner"
                focusId={TRIP_DETAIL_TITLE_ID}
              />
            }
          />
        ) : null}
        <TripHero
          trip={trip}
          ruang={ruang}
          titleId={TRIP_DETAIL_TITLE_ID}
          editAction={<EditTripIsland />}
          archiveAction={<ArchiveTripIsland />}
          addBudgetAction={<AddTripBudgetIsland />}
        />
        <TripBudgetCard trip={trip} ruang={ruang} />
        <TripCandidatesCard
          trip={trip}
          candidates={candidates}
          candidatesMore={candidatesMore}
          openImport={<ImportEntriesIsland count={candidates.length} />}
        />
        <TripBreakdownCard trip={trip} breakdown={breakdown} memberCount={memberCount} />
        <TripEntriesCard
          trip={trip}
          entries={entries}
          entriesTruncated={entriesTruncated}
          hasCandidates={candidates.length > 0}
          today={today}
          headingId={TRIP_ENTRIES_HEADING_ID}
          entryHref={(entryId) => buildEntryHref(ruang, entryId, '')}
          removeEntry={(entry, title) => (
            <RemoveTripEntryIsland
              entryId={entry.id}
              title={title}
              nextEntryId={nextIdOf.get(entry.id) ?? null}
            />
          )}
        />
      </article>
    </TripDetailHostIsland>
  );
}

/** Gagal muat Detail trip (galat loader ditangkap page): `BackLink` tetap + Coba lagi. */
export function TripDetailFailed({ ruang }: { ruang: Ruang }) {
  return (
    <article className={WIDTH}>
      <BackLink href={buildTripListHref(ruang, '')}>{C.title}</BackLink>
      <ErrorState
        title={C.detailFailedTitle}
        description={C.failedDescription}
        actions={<RetryIsland />}
      />
    </article>
  );
}

/** Kerangka hero + dua kartu selama server memuat Detail trip (`loading.tsx`, TR10). */
export function TripDetailLoading() {
  return (
    <section className={WIDTH}>
      <LoadingRegion label={C.loading}>
        <Skeleton className="h-44" />
        <Skeleton className="h-32" />
        <Skeleton className="h-40" />
      </LoadingRegion>
    </section>
  );
}
