import { describe, expect, it } from 'vitest';
import { resolveDate } from './date';
import type { DateSpec } from './parse';

const TODAY = '2026-11-11';
const r = (spec: DateSpec, today = TODAY) => resolveDate(spec, today);

describe('resolveDate', () => {
  it('ago: kemarin = hari ini - 1, lintas bulan/tahun', () => {
    expect(r({ kind: 'ago', days: 1 })).toEqual({ ok: true, iso: '2026-11-10' });
    expect(r({ kind: 'ago', days: 1 }, '2026-03-01')).toEqual({ ok: true, iso: '2026-02-28' });
    expect(r({ kind: 'ago', days: 1 }, '2027-01-01')).toEqual({ ok: true, iso: '2026-12-31' });
  });
  it('day: kejadian terakhir yang <= hari ini (bulan ini, bila belum lewat, bulan lalu)', () => {
    expect(r({ kind: 'day', day: 9 })).toEqual({ ok: true, iso: '2026-11-09' });
    expect(r({ kind: 'day', day: 11 })).toEqual({ ok: true, iso: '2026-11-11' });
    expect(r({ kind: 'day', day: 25 })).toEqual({ ok: true, iso: '2026-10-25' });
    expect(r({ kind: 'day', day: 28 }, '2027-01-05')).toEqual({ ok: true, iso: '2026-12-28' });
  });
  it('day: bulan tanpa tanggal itu dilewati (31 pada Maret -> Januari)', () => {
    expect(r({ kind: 'day', day: 31 }, '2026-03-05')).toEqual({ ok: true, iso: '2026-01-31' });
    expect(r({ kind: 'day', day: 30 }, '2026-03-05')).toEqual({ ok: true, iso: '2026-01-30' });
  });
  it('dm: tahun ini bila sudah lewat; belum terjadi dan dekat = future; jauh = tahun lalu', () => {
    expect(r({ kind: 'dm', day: 9, month: 11 })).toEqual({ ok: true, iso: '2026-11-09' });
    expect(r({ kind: 'dm', day: 11, month: 11 })).toEqual({ ok: true, iso: '2026-11-11' });
    expect(r({ kind: 'dm', day: 12, month: 11 })).toEqual({ ok: false, reason: 'future' });
    expect(r({ kind: 'dm', day: 25, month: 12 })).toEqual({ ok: false, reason: 'future' });
    expect(r({ kind: 'dm', day: 28, month: 12 }, '2027-01-02')).toEqual({
      ok: true,
      iso: '2026-12-28',
    });
    expect(r({ kind: 'dm', day: 20, month: 8 }, '2026-01-02')).toEqual({
      ok: true,
      iso: '2025-08-20',
    });
  });
  it('dm: 29 Februari mencari tahun kabisat terakhir', () => {
    expect(r({ kind: 'dm', day: 29, month: 2 })).toEqual({ ok: true, iso: '2024-02-29' });
  });
  it('full: apa adanya; masa depan ditolak; sebelum 2000 ditolak', () => {
    expect(r({ kind: 'full', year: 2025, month: 3, day: 7 })).toEqual({
      ok: true,
      iso: '2025-03-07',
    });
    expect(r({ kind: 'full', year: 2026, month: 11, day: 11 })).toEqual({
      ok: true,
      iso: '2026-11-11',
    });
    expect(r({ kind: 'full', year: 2026, month: 11, day: 12 })).toEqual({
      ok: false,
      reason: 'future',
    });
    expect(r({ kind: 'full', year: 1999, month: 12, day: 31 })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});
