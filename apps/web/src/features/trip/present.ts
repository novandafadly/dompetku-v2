import { weekdayDateLabel, type IsoDate } from '@dompetku/domain';
import type { TripVM } from '@/features/ledger/trip-types';

export {
  inTripRange,
  rangeLabel,
  rangeParts,
  suggestTrip,
  tripDaysDiff,
  tripPhaseAt,
  type RangeParts,
} from '@/features/ledger/trip-present';

/**
 * Pengelompokan daftar Trip (S15-TR2):
 * - aktif dibagi berdasarkan `phase` dari SQL (bukan tanggal klien): `Berlangsung`, `Akan datang`,
 *   `Selesai`.
 * - `Berlangsung` dan `Selesai`: urutan SQL (`startsOn` turun).
 * - `Akan datang`: mulai terdekat dulu (urut terbalik dari SQL).
 * - `Diarsipkan`: terpisah di `details` terlipat.
 */
export interface GroupedTrips {
  ongoing: TripVM[];
  upcoming: TripVM[];
  ended: TripVM[];
  archived: TripVM[];
}

export function groupTrips(trips: readonly TripVM[]): GroupedTrips {
  const ongoing: TripVM[] = [];
  const upcoming: TripVM[] = [];
  const ended: TripVM[] = [];
  const archived: TripVM[] = [];
  for (const t of trips) {
    if (t.archived) {
      archived.push(t);
    } else if (t.phase === 'ongoing') {
      ongoing.push(t);
    } else if (t.phase === 'upcoming') {
      upcoming.push(t);
    } else {
      ended.push(t);
    }
  }
  upcoming.sort((a, b) =>
    a.startsOn !== b.startsOn ? (a.startsOn < b.startsOn ? -1 : 1) : a.id < b.id ? -1 : 1,
  );
  return { ongoing, upcoming, ended, archived };
}

/**
 * Label baris `Per hari` (S15-TR7): `Sab, 12 Des` (tambah tahun bila beda dari tahun trip), plus
 * penanda apakah tanggal berada di luar rentang trip (`startsOn..endsOn`, K5).
 */
export function tripBreakdownDay(
  date: IsoDate,
  startsOn: IsoDate,
  endsOn: IsoDate,
): { label: string; outOfRange: boolean } {
  const y = date.slice(0, 4);
  const yStart = startsOn.slice(0, 4);
  const yEnd = endsOn.slice(0, 4);
  const base = weekdayDateLabel(date);
  const label = y !== yStart && y !== yEnd ? `${base} ${y}` : base;
  return { label, outOfRange: date < startsOn || date > endsOn };
}
