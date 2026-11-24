'use client';

import type { IsoDate } from '@dompetku/domain';
import { AirplaneTiltIcon } from '@/components/ui/icons/airplane-tilt';
import { ArchiveIcon } from '@/components/ui/icons/archive';
import { CalendarBlankIcon } from '@/components/ui/icons/calendar-blank';
import { CheckIcon } from '@/components/ui/icons/check';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { focusRing, rowDivider } from '@/components/ui/styles';
import { inTripRange, rangeLabel, tripPhaseAt } from '@/features/ledger/trip-present';
import type { TripChoiceVM } from '@/features/ledger/trip-types';
import { TRIP_PICKER_COPY as C, type SelectedTrip } from './trip-picker';

/**
 * Halaman dalam-sheet `Pilih trip · {Ruang}` (S15-TR14, TR15; dimuat malas seperti
 * `SplitSharesPage`): `radiogroup` dengan opsi pertama `Tidak masuk trip`, lalu trip yang memuat
 * tanggal entri lebih dulu (`Sesuai tanggal`), lalu sisanya. Memilih langsung menerapkan dan
 * kembali ke formulir.
 */
export function TripChoicePage({
  trips,
  value,
  date,
  today,
  ownArchived,
  onSelect,
}: {
  trips: readonly TripChoiceVM[];
  value: string | null;
  date: IsoDate;
  today: IsoDate;
  /** Di Ubah: trip entri sendiri yang sudah terarsip (hanya tampil bila masih terpilih). */
  ownArchived?: SelectedTrip | null | undefined;
  onSelect: (tripId: string | null) => void;
}) {
  const matching: TripChoiceVM[] = [];
  const others: TripChoiceVM[] = [];
  for (const t of trips) {
    if (inTripRange(t, date)) matching.push(t);
    else others.push(t);
  }
  const ordered = [...matching, ...others];

  const activeArchived = ownArchived?.id === value ? ownArchived : undefined;
  return (
    <div role="radiogroup" aria-label="Pilih trip" className="flex flex-col">
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        onClick={() => {
          onSelect(null);
        }}
        className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left hover-pointer:bg-hover active:bg-surface-2 ${focusRing}`}
      >
        <span className="text-body font-semibold text-text">{C.none}</span>
        {value === null ? (
          <CheckIcon size={18} weight="bold" className="shrink-0 text-accent-text" />
        ) : null}
      </button>
      {activeArchived !== undefined ? (
        <div className={rowDivider}>
          <button
            type="button"
            role="radio"
            aria-checked={true}
            onClick={() => {
              onSelect(activeArchived.id);
            }}
            className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left hover-pointer:bg-hover active:bg-surface-2 ${focusRing}`}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                title={activeArchived.name}
                className="line-clamp-2 text-body font-semibold break-words text-text"
              >
                {C.archivedSuffix(activeArchived.name)}
              </span>
              <span className="inline-flex items-center gap-1 text-meta font-semibold text-text-muted">
                <ArchiveIcon size={14} className="shrink-0" />
                <span>Diarsipkan</span>
              </span>
            </span>
            <CheckIcon size={18} weight="bold" className="shrink-0 text-accent-text" />
          </button>
        </div>
      ) : null}
      {ordered.map((t) => {
        const checked = value === t.id;
        const matches = inTripRange(t, date);
        const phase = tripPhaseAt(t, today);
        return (
          <div key={t.id} className={rowDivider}>
            <button
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => {
                onSelect(t.id);
              }}
              className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left hover-pointer:bg-hover active:bg-surface-2 ${focusRing}`}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  title={t.name}
                  className="line-clamp-2 text-body font-semibold break-words text-text"
                >
                  {t.name}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta font-medium text-text-muted">
                  <span>{rangeLabel(t.startsOn, t.endsOn)}</span>
                  <PhaseInline phase={phase} />
                  {matches ? (
                    <span className="inline-flex items-center gap-1 text-caption font-semibold text-accent-text">
                      <CheckIcon size={14} weight="bold" className="shrink-0" />
                      <span>{C.dateMatches}</span>
                    </span>
                  ) : null}
                </span>
              </span>
              {checked ? (
                <CheckIcon size={18} weight="bold" className="shrink-0 text-accent-text" />
              ) : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function PhaseInline({ phase }: { phase: 'upcoming' | 'ongoing' | 'ended' }) {
  if (phase === 'ongoing') {
    return (
      <span className="inline-flex items-center gap-1 text-meta font-semibold text-accent-text">
        <AirplaneTiltIcon size={14} weight="fill" className="shrink-0" />
        <span>Berlangsung</span>
      </span>
    );
  }
  if (phase === 'upcoming') {
    return (
      <span className="inline-flex items-center gap-1 text-meta font-semibold text-text-soft">
        <CalendarBlankIcon size={14} className="shrink-0" />
        <span>Akan datang</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-meta font-semibold text-text-soft">
      <CheckCircleIcon size={14} className="shrink-0" />
      <span>Selesai</span>
    </span>
  );
}

export default TripChoicePage;
