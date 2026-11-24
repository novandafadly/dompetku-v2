import type { IsoDate } from '@dompetku/domain';
import { AirplaneTiltIcon } from '@/components/ui/icons/airplane-tilt';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { ListCard } from '@/components/ui/list-card';
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/ui/state';
import { card, focusRing } from '@/components/ui/styles';
import type { TripVM } from '@/features/ledger/trip-types';
import type { Ruang } from '@/features/ledger/types';
import { buildTripHref } from '@/features/shell/trip-hrefs';
import { TRIP_COPY as C } from '@/features/trip/copy';
import { groupTrips } from '@/features/trip/present';
import { ArchivedTripRow, TripRow } from '@/features/trip/trip-row';
import { KategoriBackIsland } from './kategori-islands';
import { RetryIsland } from './transaksi-islands';
import { TRIP_TITLE_ID } from './trip-ids';
import { AddTripIsland, RestoreTripIsland, TripListHostIsland } from './trip-islands';

/**
 * Halaman daftar Trip mode nyata (Server Component; S15-TR2, TR3, TR4): kedua ruang (Pribadi dan
 * Bersama, termasuk Bersama solo). Grup ditentukan `phase` SQL (`Berlangsung`, `Akan datang`,
 * `Selesai`), `Trip diarsipkan` terlipat di bawah. Tanpa ringkasan total semua trip.
 */

const WIDTH = 'flex flex-col gap-3 tablet:gap-4 laptop:max-w-180 laptop:pt-6';

function Header({ ruang, action }: { ruang: Ruang; action?: React.ReactNode }) {
  return (
    <>
      <KategoriBackIsland ruang={ruang} />
      <div className="flex flex-col gap-3 laptop:flex-row laptop:items-end laptop:justify-between">
        <h1
          id={TRIP_TITLE_ID}
          tabIndex={-1}
          className="text-headline font-extrabold text-text outline-none laptop:text-title-lg"
        >
          {C.pageTitle(ruang)}
        </h1>
        {action}
      </div>
    </>
  );
}

function TripGroup({ title, trips, ruang }: { title: string; trips: TripVM[]; ruang: Ruang }) {
  if (trips.length === 0) return null;
  return (
    <ListCard title={title}>
      <ul>
        {trips.map((t) => (
          <TripRow key={t.id} trip={t} href={buildTripHref(ruang, t.id, '')} />
        ))}
      </ul>
    </ListCard>
  );
}

export function TripReal({
  ruang,
  today,
  trips,
}: {
  ruang: Ruang;
  today: IsoDate;
  trips: TripVM[];
}) {
  const { ongoing, upcoming, ended, archived } = groupTrips(trips);
  const hasActive = ongoing.length + upcoming.length + ended.length > 0;
  return (
    <TripListHostIsland ruang={ruang} today={today}>
      <section className={WIDTH}>
        <Header
          ruang={ruang}
          action={
            trips.length > 0 ? (
              <AddTripIsland variant="secondary" plus className="w-full laptop:w-auto" />
            ) : undefined
          }
        />
        {trips.length === 0 ? (
          <EmptyState
            tone="accent"
            icon={<AirplaneTiltIcon size={28} />}
            title={C.emptyTitle}
            headingLevel={2}
            description={C.emptyDescription}
            action={<AddTripIsland variant="primary" />}
          />
        ) : (
          <>
            {hasActive ? (
              <>
                <TripGroup title={C.phaseOngoing} trips={ongoing} ruang={ruang} />
                <TripGroup title={C.phaseUpcoming} trips={upcoming} ruang={ruang} />
                <TripGroup title={C.phaseEnded} trips={ended} ruang={ruang} />
              </>
            ) : (
              <p className="text-meta font-medium text-text-soft">{C.noActiveTrips}</p>
            )}
            {archived.length > 0 ? (
              <details className={`group ${card} px-4`}>
                <summary
                  className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg text-label font-bold text-text-soft ${focusRing}`}
                >
                  {C.archivedGroup(archived.length)}
                  <CaretDownIcon
                    size={16}
                    weight="bold"
                    className="shrink-0 group-open:rotate-180"
                  />
                </summary>
                <ul className="pb-1">
                  {archived.map((t) => (
                    <ArchivedTripRow
                      key={t.id}
                      trip={t}
                      href={buildTripHref(ruang, t.id, '')}
                      restore={<RestoreTripIsland tripId={t.id} name={t.name} variant="row" />}
                    />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </section>
    </TripListHostIsland>
  );
}

/** Gagal muat daftar Trip (galat loader ditangkap page): salinan tetap + Coba lagi. */
export function TripFailed({ ruang }: { ruang: Ruang }) {
  return (
    <section className={WIDTH}>
      <Header ruang={ruang} />
      <ErrorState
        title={C.failedTitle}
        description={C.failedDescription}
        actions={<RetryIsland />}
      />
    </section>
  );
}

/** Kerangka tiga baris 72 px selama server memuat daftar Trip (`loading.tsx`, TR4). */
export function TripLoading() {
  return (
    <section className={WIDTH}>
      <LoadingRegion label={C.loading}>
        <Skeleton className="h-18" />
        <Skeleton className="h-18" />
        <Skeleton className="h-18" />
      </LoadingRegion>
    </section>
  );
}
