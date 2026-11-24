import { describe, expect, it } from 'vitest';
import type { TripChoiceVM, TripVM } from '@/features/ledger/trip-types';
import {
  groupTrips,
  rangeLabel,
  suggestTrip,
  tripBreakdownDay,
  tripDaysDiff,
  tripPhaseAt,
} from './present';

const trip = (over: Partial<TripVM> = {}): TripVM => ({
  id: 't1',
  name: 'Bali',
  startsOn: '2026-12-12',
  endsOn: '2026-12-19',
  budget: null,
  archived: false,
  phase: 'ongoing',
  dayCount: 8,
  spent: 0,
  entryCount: 0,
  budgetLeft: null,
  ...over,
});

describe('rangeLabel (aturan 7 bingkai S15)', () => {
  it('hari sama, bulan sama, tahun sama, beda tahun', () => {
    expect(rangeLabel('2026-12-12', '2026-12-12')).toBe('12 Des 2026');
    expect(rangeLabel('2026-12-12', '2026-12-19')).toBe('12–19 Des 2026');
    expect(rangeLabel('2026-11-28', '2026-12-03')).toBe('28 Nov – 3 Des 2026');
    expect(rangeLabel('2026-12-28', '2027-01-03')).toBe('28 Des 2026 – 3 Jan 2027');
  });
});

describe('tripDaysDiff', () => {
  it('menghitung selisih hari inklusif - 1', () => {
    expect(tripDaysDiff('2026-12-12', '2026-12-12')).toBe(0);
    expect(tripDaysDiff('2026-12-12', '2026-12-11')).toBe(-1);
    expect(tripDaysDiff('2026-01-01', '2027-01-01')).toBe(365);
    expect(tripDaysDiff('2026-01-01', '2027-01-02')).toBe(366);
  });
});

describe('suggestTrip (K9)', () => {
  const choices: TripChoiceVM[] = [
    { id: 't1', name: 'Bali', startsOn: '2026-12-12', endsOn: '2026-12-19' },
    { id: 't2', name: 'Lombok', startsOn: '2026-12-18', endsOn: '2026-12-22' },
  ];

  it('tepat satu trip cocok = disarankan', () => {
    expect(suggestTrip(choices, '2026-12-12')?.id).toBe('t1');
    expect(suggestTrip(choices, '2026-12-17')?.id).toBe('t1');
    expect(suggestTrip(choices, '2026-12-20')?.id).toBe('t2');
  });

  it('nol atau dua trip tumpang tindih = tidak ada saran', () => {
    expect(suggestTrip(choices, '2026-12-11')).toBeNull();
    expect(suggestTrip(choices, '2026-12-18')).toBeNull();
    expect(suggestTrip(choices, '2026-12-19')).toBeNull();
    expect(suggestTrip([], '2026-12-15')).toBeNull();
  });
});

describe('groupTrips (S15-TR2)', () => {
  it('memisahkan fase SQL dan mengurutkan Akan datang dari mulai terdekat', () => {
    const grouped = groupTrips([
      trip({ id: 'u2', phase: 'upcoming', startsOn: '2027-02-01' }),
      trip({ id: 'u1', phase: 'upcoming', startsOn: '2027-01-05' }),
      trip({ id: 'o1', phase: 'ongoing', startsOn: '2026-12-12' }),
      trip({ id: 'e1', phase: 'ended', startsOn: '2026-10-01' }),
      trip({ id: 'a1', phase: 'ended', archived: true }),
    ]);
    expect(grouped.ongoing.map((t) => t.id)).toEqual(['o1']);
    expect(grouped.upcoming.map((t) => t.id)).toEqual(['u1', 'u2']);
    expect(grouped.ended.map((t) => t.id)).toEqual(['e1']);
    expect(grouped.archived.map((t) => t.id)).toEqual(['a1']);
  });
});

describe('tripBreakdownDay & tripPhaseAt', () => {
  it('menandai tanggal di luar rentang trip dan menyertakan tahun bila beda', () => {
    expect(tripBreakdownDay('2026-12-12', '2026-12-12', '2026-12-19')).toEqual({
      label: 'Sab, 12 Des',
      outOfRange: false,
    });
    expect(tripBreakdownDay('2026-12-01', '2026-12-12', '2026-12-19')).toEqual({
      label: 'Sel, 1 Des',
      outOfRange: true,
    });
    expect(tripBreakdownDay('2025-11-10', '2026-12-12', '2026-12-19')).toEqual({
      label: 'Sen, 10 Nov 2025',
      outOfRange: true,
    });
  });

  it('tripPhaseAt menentukan fase dari tanggal', () => {
    const t = { startsOn: '2026-12-12', endsOn: '2026-12-19' };
    expect(tripPhaseAt(t, '2026-12-11')).toBe('upcoming');
    expect(tripPhaseAt(t, '2026-12-12')).toBe('ongoing');
    expect(tripPhaseAt(t, '2026-12-19')).toBe('ongoing');
    expect(tripPhaseAt(t, '2026-12-20')).toBe('ended');
  });
});
