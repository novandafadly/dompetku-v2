import { daysInclusive, shortDateLabel, type IsoDate } from '@dompetku/domain';
import type { TripChoiceVM, TripPhase } from './trip-types';

/**
 * Pembantu murni Trip bersama (`ledger-vm`): dipakai baik oleh `features/trip` maupun
 * `features/catat` (pemilih Trip dan saran K9) tanpa pelanggaran batas antar fitur.
 * Tidak ada aritmetika uang di sini; hanya format tanggal dan perbandingan rentang.
 */

export interface RangeParts {
  /** Tanggal tunggal (`startsOn === endsOn`) atau rentang dua bagian yang tidak pecah di tengah. */
  start: string;
  end: string | null;
  separator: '–' | ' – ';
}

/**
 * Pecahan rentang tanggal (aturan 7 bingkai S15):
 * - sama hari: `12 Des 2026`
 * - bulan dan tahun sama: `12–19 Des 2026`
 * - tahun sama, bulan beda: `28 Nov – 3 Des 2026`
 * - beda tahun: `28 Des 2026 – 3 Jan 2027`
 */
export function rangeParts(startsOn: IsoDate, endsOn: IsoDate): RangeParts {
  const y1 = startsOn.slice(0, 4);
  const y2 = endsOn.slice(0, 4);
  const m1 = startsOn.slice(5, 7);
  const m2 = endsOn.slice(5, 7);
  if (startsOn === endsOn) {
    return { start: `${shortDateLabel(startsOn)} ${y1}`, end: null, separator: '–' };
  }
  if (y1 === y2 && m1 === m2) {
    const d1 = String(Number(startsOn.slice(8, 10)));
    return { start: d1, end: `${shortDateLabel(endsOn)} ${y2}`, separator: '–' };
  }
  if (y1 === y2) {
    return {
      start: shortDateLabel(startsOn),
      end: `${shortDateLabel(endsOn)} ${y2}`,
      separator: ' – ',
    };
  }
  return {
    start: `${shortDateLabel(startsOn)} ${y1}`,
    end: `${shortDateLabel(endsOn)} ${y2}`,
    separator: ' – ',
  };
}

/** Teks rentang tanggal satu string (untuk kalimat toast, kartu kandidat, dan aria-label). */
export function rangeLabel(startsOn: IsoDate, endsOn: IsoDate): string {
  const p = rangeParts(startsOn, endsOn);
  return p.end === null ? p.start : `${p.start}${p.separator}${p.end}`;
}

/** Selisih hari (`endsOn - startsOn`): `< 0` terbalik; `> 365` melebihi 366 hari inklusif. */
export function tripDaysDiff(startsOn: IsoDate, endsOn: IsoDate): number {
  return daysInclusive(startsOn, endsOn) - 1;
}

/** Tanggal berada dalam rentang inklusif trip. */
export function inTripRange(
  trip: Pick<TripChoiceVM, 'startsOn' | 'endsOn'>,
  date: IsoDate,
): boolean {
  return trip.startsOn !== '' && trip.endsOn !== '' && trip.startsOn <= date && date <= trip.endsOn;
}

/**
 * Saran awal trip di Catat (K9, S15-TR16):
 * bila tepat satu trip aktif memuat `date`, trip itu dipilih awal; nol atau ≥ 2 tumpang tindih =
 * `null` (pengguna memilih sendiri). Satu fungsi murni agar mudah dimatikan bila pemilik mau.
 */
export function suggestTrip(trips: readonly TripChoiceVM[], date: IsoDate): TripChoiceVM | null {
  let match: TripChoiceVM | null = null;
  for (const t of trips) {
    if (!inTripRange(t, date)) continue;
    if (match !== null) return null;
    match = t;
  }
  return match;
}

/** Fase turunan dari tanggal (untuk daftar pilihan di Catat/Ubah; halaman Trip memakai `phase` SQL). */
export function tripPhaseAt(
  trip: Pick<TripChoiceVM, 'startsOn' | 'endsOn'>,
  today: IsoDate,
): TripPhase {
  if (today < trip.startsOn) return 'upcoming';
  if (today > trip.endsOn) return 'ended';
  return 'ongoing';
}
