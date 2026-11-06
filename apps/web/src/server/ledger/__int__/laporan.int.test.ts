import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadLaporan, parseLaporanParams } from '../laporan';
import { withLedger } from '../retry';
import { createLedgerHarness, resetLedger } from './harness';
import { clockEnv, ctxAt, GOLDEN, seedS9, TODAY, type Clock, type S9Fixture } from './s9';

/**
 * `loadLaporan` (S9 Task 9): basis gajian/kalender, parameter URL rusak = periode berjalan,
 * navigasi periode, tren. Angka golden `s9.ts`; kesamaan dengan Beranda/Rencana di
 * `rencana.int.test.ts`.
 */

const h = createLedgerHarness();
let clock: Clock;
let fx: S9Fixture;

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetLedger(h);
  clock = await clockEnv(h);
  fx = await seedS9(h, clock);
});

afterEach(async () => {
  await clock.restore();
});

describe('loadLaporan', () => {
  it('Laporan bulan kalender dan parameter rusak', async () => {
    const ctx = await ctxAt(clock.at(TODAY), fx.n, 'pribadi');
    const k = await loadLaporan(ctx, { label: '2026-11', basis: 'kalender' });
    expect(k.period).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-30',
      basis: 'kalender',
      isCurrent: true,
      complete: false,
      daysLeft: 25,
      next: null,
      prev: '2026-10',
    });
    expect(k.summary.pengeluaran).toBe(GOLDEN.pengeluaranKalender);
    expect(k.budgets).toBeNull();
    for (const params of [
      { label: '2099-01' },
      { label: 'rusak', basis: 'x' },
      { label: ['2026-10', '2026-09'] },
      { label: '2019-12' },
    ]) {
      const l = await loadLaporan(ctx, params);
      expect(l.period).toMatchObject({ labelMonth: GOLDEN.labelMonth, basis: 'gajian' });
    }
    const okt = await loadLaporan(ctx, { label: '2026-10' });
    expect(okt.period).toMatchObject({
      from: '2026-09-25',
      to: '2026-10-22',
      isCurrent: false,
      complete: true,
      daysLeft: null,
      next: '2026-11',
    });
    // Tren 6 periode sampai periode berjalan: Jun–Okt tanpa Pemasukan/Pengeluaran (saldo awal 1 Okt
    // = koreksi) dibuang, tersisa periode berjalan.
    expect(okt.trend).toMatchObject([
      { labelMonth: GOLDEN.labelMonth, isCurrent: true, pengeluaran: GOLDEN.pengeluaran },
    ]);
  });

  it('excluded_summary per arah = period_summary per kelas', async () => {
    const ctx = await ctxAt(clock.at(TODAY), fx.n, 'pribadi');
    const l = await loadLaporan(ctx);
    const { rows } = await withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) =>
      c.query<{ report_class: string; inflow: number; outflow: number }>(
        `select report_class, inflow, outflow from api.period_summary($1, $2::date, $3::date)
        where report_class like 'x\\_%'`,
        [ctx.spaceId, GOLDEN.from, GOLDEN.to],
      ),
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      const get = (d: 'in' | 'out') =>
        l.classes.find((c) => c.reportClass === r.report_class && c.direction === d)?.amount ?? 0;
      expect([get('in'), get('out')]).toEqual([r.inflow, r.outflow]);
    }
  });
});

describe('parseLaporanParams', () => {
  it('nilai sah dipakai; rusak, larik, atau sebelum 2020-01 dibuang; basis bawaan gajian', () => {
    expect(parseLaporanParams({ label: '2026-10', basis: 'kalender' })).toEqual({
      label: '2026-10',
      basis: 'kalender',
    });
    expect(parseLaporanParams({ label: '2026-13', basis: 'GAJIAN' })).toEqual({
      label: undefined,
      basis: 'gajian',
    });
    expect(parseLaporanParams({ label: ['2026-10'], basis: ['kalender'] })).toEqual({
      label: undefined,
      basis: 'gajian',
    });
    expect(parseLaporanParams({ label: '2019-12' }).label).toBeUndefined();
    expect(parseLaporanParams({ label: '2020-01' }).label).toBe('2020-01');
  });
});
