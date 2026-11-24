import type { IsoDate } from '@dompetku/domain';
import { AirplaneTiltIcon } from '@/components/ui/icons/airplane-tilt';
import { ArchiveIcon } from '@/components/ui/icons/archive';
import { CalendarBlankIcon } from '@/components/ui/icons/calendar-blank';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import type { TripPhase } from '@/features/ledger/trip-types';
import { TRIP_COPY as C } from './copy';
import { rangeParts } from './present';

/**
 * Penanda fase Trip (aturan 6 bingkai S15): selalu ikon + teks 13/600; warna `accent-text` hanya
 * untuk `Berlangsung`, sisanya `text-soft`/`text-muted` (tanpa merah/hijau).
 */
export function TripPhaseBadge({
  phase,
  archived = false,
  suffix,
}: {
  phase: TripPhase;
  archived?: boolean;
  /** Tambahan konteks di Detail, mis. `hari ke 3 dari 8` atau `mulai 12 Des`. */
  suffix?: string | undefined;
}) {
  if (archived) {
    return (
      <span className="inline-flex items-center gap-1 text-meta font-semibold text-text-muted">
        <ArchiveIcon size={14} className="shrink-0" />
        <span>{C.phaseArchived}</span>
      </span>
    );
  }
  if (phase === 'ongoing') {
    return (
      <span className="inline-flex items-center gap-1 text-meta font-semibold text-accent-text">
        <AirplaneTiltIcon size={14} weight="fill" className="shrink-0" />
        <span>{suffix === undefined ? C.phaseOngoing : `${C.phaseOngoing} · ${suffix}`}</span>
      </span>
    );
  }
  if (phase === 'upcoming') {
    return (
      <span className="inline-flex items-center gap-1 text-meta font-semibold text-text-soft">
        <CalendarBlankIcon size={14} className="shrink-0" />
        <span>{suffix === undefined ? C.phaseUpcoming : `${C.phaseUpcoming} · ${suffix}`}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-meta font-semibold text-text-soft">
      <CheckCircleIcon size={14} className="shrink-0" />
      <span>{C.phaseEnded}</span>
    </span>
  );
}

/**
 * Rentang tanggal (aturan 7 bingkai S15): setiap tanggal di dalam `span whitespace-nowrap` supaya
 * pada 320 px hanya membungkus di pemisah `–`/spasi, tidak pernah pecah di tengah tanggal.
 */
export function RangeText({ startsOn, endsOn }: { startsOn: IsoDate; endsOn: IsoDate }) {
  const parts = rangeParts(startsOn, endsOn);
  if (parts.end === null) {
    return <span className="whitespace-nowrap">{parts.start}</span>;
  }
  return (
    <span>
      <span className="whitespace-nowrap">{parts.start}</span>
      {parts.separator}
      <span className="whitespace-nowrap">{parts.end}</span>
    </span>
  );
}
