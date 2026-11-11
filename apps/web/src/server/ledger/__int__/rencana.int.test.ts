import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBeranda } from '../beranda';
import { toLedgerError } from '../errors';
import { loadLaporan } from '../laporan';
import { spendPaceTx } from '../read';
import { payBill, loadRencana, setBudget, setOccurrenceSkipped } from '../rencana';
import { withLedger } from '../retry';
import { createEntry } from '../write';
import { createLedgerHarness, memuatNominal, resetLedger } from './harness';
import { clockEnv, ctxAt, GOLDEN, KANARI, seedS9, TODAY, type Clock, type S9Fixture } from './s9';

/**
 * Loader S9 (Task 9) atas Postgres nyata, persona N/F/Luar, jam DB tiruan (fixture `s9.ts`):
 * Beranda aman dipakai lengkap + kartu Tagihan/Anggaran, Rencana, dan kesamaan angka Beranda =
 * Rencana = Laporan untuk periode yang sama [T17]. Bersama tanpa kanari Pribadi [B13].
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

async function failure(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('seharusnya gagal');
    },
    (e: unknown) => e,
  );
}

describe('Beranda S9 (periode gajian, aman dipakai lengkap)', () => {
  it('golden: periode, aman dipakai, laju, Tagihan 7 hari, Anggaran hampir habis [T17]', async () => {
    const ctx = await ctxAt(clock.at(TODAY), fx.n, 'pribadi');
    const b = await loadBeranda(ctx);
    expect(b.period).toEqual({
      label: GOLDEN.label,
      from: GOLDEN.from,
      to: GOLDEN.to,
      labelMonth: GOLDEN.labelMonth,
      daysLeft: GOLDEN.daysLeft,
      holidaysKnown: true,
      basis: 'gajian',
    });
    expect(b.safe).toEqual({
      operasional: GOLDEN.operasional,
      billsUntilEom: GOLDEN.bills,
      budgetWajibRemaining: GOLDEN.wajib,
      aman: GOLDEN.aman,
      until: GOLDEN.to,
      daysLeft: GOLDEN.daysLeft,
      perDay: GOLDEN.perDay,
      status: 'aman',
      reason: null,
      hasObligations: true,
    });
    expect(b.billsDue).toEqual({
      hasBills: true,
      items: [
        {
          occurrenceId: expect.any(String) as string,
          billId: fx.ids.bill,
          name: KANARI.nTagihan,
          amount: 485_000,
          dueOn: '2026-11-10',
          daysUntil: 4,
          overdue: false,
          posted: false,
          skipped: false,
          entryId: null,
          paidOn: null,
        },
      ],
    });
    if (b.budgetsNear === 'error') throw new Error('anggaran gagal');
    expect(b.budgetsNear.hasBudgets).toBe(true);
    expect(b.budgetsNear.items.map((x) => [x.categoryId, x.pct, x.spent, x.remaining])).toEqual([
      [fx.ids.makan, 85, 1_700_000, 300_000],
    ]);
  });

  it('laju belanja dari SQL dan batas hampir habis tepat 80% (review Task 9)', async () => {
    const ctx = await ctxAt(clock.at(TODAY), fx.n, 'pribadi');
    const pace = await withLedger(ctx.pools, ctx.userId, ctx.spaceId, (c) => spendPaceTx(c, ctx));
    expect(pace.avgDaily).toBe(GOLDEN.avgDaily);
    // Makan terpakai 1.700.000; anggaran 2.125.000 = tepat 80% (masih hampir habis).
    await setBudget(ctx, {
      categoryId: fx.ids.makan,
      month: GOLDEN.labelMonth.slice(0, 7),
      amount: 2_125_000,
      wajib: false,
    });
    const b = await loadBeranda(ctx);
    if (b.budgetsNear === 'error') throw new Error('anggaran gagal');
    expect(b.budgetsNear.items.map((x) => [x.categoryId, x.pct])).toEqual([[fx.ids.makan, 80]]);
  });

  it('tagihan lewat jatuh tempo: hati-hati sebab overdue, kartu menandai lewat', async () => {
    const ctx = await ctxAt(clock.at('2026-11-12T08:00:00+07:00'), fx.n, 'pribadi');
    const b = await loadBeranda(ctx);
    expect(b.safe).toMatchObject({ status: 'hati_hati', reason: { kind: 'overdue', count: 1 } });
    expect(b.period.daysLeft).toBe(13);
    if (b.billsDue === 'error') throw new Error('tagihan gagal');
    expect(b.billsDue.items).toMatchObject([{ overdue: true, daysUntil: -2, dueOn: '2026-11-10' }]);
  });

  it('bayar tagihan: saldo turun, aman dipakai tetap; lewati = tidak dihitung', async () => {
    const ctx = await ctxAt(clock.at(TODAY), fx.n, 'pribadi');
    const before = await loadBeranda(ctx);
    if (before.billsDue === 'error') throw new Error('tagihan gagal');
    const occ = before.billsDue.items[0]?.occurrenceId;
    if (!occ) throw new Error('kemunculan tidak ada');

    // Lewati: tagihan tidak lagi memotong aman dipakai; batalkan lewati = kembali.
    await setOccurrenceSkipped(ctx, occ, true);
    expect((await loadBeranda(ctx)).safe).toMatchObject({
      billsUntilEom: 0,
      aman: GOLDEN.aman + GOLDEN.bills,
    });
    await setOccurrenceSkipped(ctx, occ, false);

    const clientId = randomUUID();
    const pay = await payBill(ctx, { clientId, occurrenceId: occ });
    const again = await payBill(ctx, { clientId, occurrenceId: occ });
    expect(again).toMatchObject({ entryId: pay.entryId, replayed: true });
    const { rows } = await h.admin.query<{ n: number }>(
      `select count(*)::int as n from app.entries where space_id = $1 and description = $2`,
      [ctx.spaceId, KANARI.nTagihan],
    );
    expect(rows[0]?.n).toBe(1);
    expect(
      toLedgerError(await failure(payBill(ctx, { clientId: randomUUID(), occurrenceId: occ }))),
    ).toEqual({
      code: 'already_posted',
    });

    const after = await loadBeranda(ctx);
    expect(after.safe).toMatchObject({
      operasional: GOLDEN.operasional - GOLDEN.bills,
      billsUntilEom: 0,
      aman: GOLDEN.aman,
    });
    if (after.billsDue === 'error') throw new Error('tagihan gagal');
    expect(after.billsDue.items).toEqual([]);
    // Rencana: lunas membawa tanggal bayar dari entri; hari ini dari SQL; Berikutnya sesudah periode.
    const rc = await loadRencana(ctx);
    expect(rc.today).toBe(TODAY.slice(0, 10));
    expect(rc.due.find((d) => d.occurrenceId === occ)).toMatchObject({
      posted: true,
      paidOn: TODAY.slice(0, 10),
      amount: GOLDEN.bills,
    });
    expect(rc.upcoming.every((u) => u.dueOn > rc.period.to)).toBe(true);
    expect(rc.due.every((d) => d.dueOn <= rc.period.to)).toBe(true);
    // Laporan ikut: pengeluaran bertambah nominal bayar (kategori tagihan).
    expect((await loadLaporan(ctx)).summary.pengeluaran).toBe(GOLDEN.pengeluaran + GOLDEN.bills);
  });

  it('Kontribusi Bersama memakai periode gajian (K10)', async () => {
    for (const p of [fx.n, fx.f]) {
      const b = await loadBeranda(await ctxAt(clock.at(TODAY), p, 'bersama'));
      const c = b.bersama?.contributions;
      if (!c || c === 'error') throw new Error('Kontribusi tidak dimuat');
      expect(c.period).toEqual({ from: GOLDEN.from, to: GOLDEN.to, label: 'November' });
      expect(c.rows.map((r) => [r.member.id, r.setoran, r.diambil])).toEqual([
        [fx.n.id, GOLDEN.bersamaSetor, 0],
        [fx.f.id, 0, 0],
      ]);
    }
  });

  it('galat kartu Tagihan/Anggaran: savepoint, kartu lain dan Beranda tetap; DK404 dilempar', async () => {
    const ctx = await ctxAt(clock.at(TODAY), fx.n, 'pribadi');
    const proto: { query: (...a: unknown[]) => unknown } = pg.Client.prototype;
    const original = proto.query;
    let replacement = 'select 1/0, $1::text, $2::text';
    const spy = vi.spyOn(proto, 'query').mockImplementation(function (
      this: unknown,
      ...args: unknown[]
    ): unknown {
      if (typeof args[0] === 'string' && args[0].includes('api.bills_due(p_space_id')) {
        args[0] = replacement;
      }
      return Reflect.apply(original, this, args);
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const b = await loadBeranda(ctx);
      expect(b.billsDue).toBe('error');
      expect(b.budgetsNear).not.toBe('error');
      expect(b.safe.aman).toBe(GOLDEN.aman);
      const logged = log.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(logged).toContain('[beranda] bills gagal dimuat: 22012');
      expect(logged).not.toContain(KANARI.nTagihan);
      expect(memuatNominal(log.mock.calls, GOLDEN.bills)).toBe(false);
      // Keanggotaan hilang di tengah muat: not_found, bukan kartu galat.
      replacement = `select app.assert_member('00000000-0000-0000-0000-000000000000'::uuid),
                            $1::text, $2::text`;
      expect(toLedgerError(await failure(loadBeranda(ctx)))).toEqual({ code: 'not_found' });
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
  });
});

describe('Rencana dan Laporan: angka sama dengan Beranda [T17]', () => {
  it('Pribadi N: periode sama, Σ realisasi anggaran + biaya = Pengeluaran Laporan [T17]', async () => {
    const ctx = await ctxAt(clock.at(TODAY), fx.n, 'pribadi');
    const [b, r, l] = [await loadBeranda(ctx), await loadRencana(ctx), await loadLaporan(ctx)];
    expect(r.period).toEqual(b.period);
    expect([l.period.from, l.period.to, l.period.labelMonth]).toEqual([
      b.period.from,
      b.period.to,
      b.period.labelMonth,
    ]);
    expect(l.summary).toMatchObject({
      pemasukan: GOLDEN.pemasukan,
      pengeluaran: GOLDEN.pengeluaran,
      selisih: GOLDEN.selisih,
    });
    // Tanpa anggaran wajib yang memakan bayar tagihan periode lain: realisasi = kategori Laporan.
    const spent = r.budgets.reduce((s, x) => s + x.spent, 0);
    const fee = l.categories.filter((c) => c.kind !== 'category' && c.type === 'expense');
    expect(spent + fee.reduce((s, x) => s + x.amount, 0)).toBe(l.summary.pengeluaran);
    expect(fee).toMatchObject([{ kind: 'fee', amount: GOLDEN.fee }]);
    // Realisasi anggaran Rencana = Beranda = budget_progress Laporan.
    const makanR = r.budgets.find((x) => x.categoryId === fx.ids.makan);
    const makanB = b.budgetsNear === 'error' ? null : b.budgetsNear.items[0];
    expect(makanB).toEqual(makanR);
    expect(l.budgets?.find((x) => x.categoryId === fx.ids.makan)).toMatchObject({
      spent: 1_700_000,
      pct: 85,
    });
    const roots = l.categories.filter((c) => c.kind === 'category' && c.type === 'expense');
    for (const x of r.budgets.filter((y) => y.spent > 0)) {
      expect(roots.find((c) => c.categoryId === x.categoryId)?.rootTotal).toBe(x.spent);
    }
    // Tidak termasuk: Kas Kantor keluar dan setor ke Bersama.
    expect(l.classes).toEqual(
      expect.arrayContaining([
        { reportClass: 'x_kantor', direction: 'out', amount: GOLDEN.kantor, entryCount: 1 },
        { reportClass: 'x_setor_bersama', direction: 'out', amount: GOLDEN.setor, entryCount: 1 },
      ]),
    );
    expect(l.contributions).toBeNull();

    // Total kartu dari SQL = Σ baris beranggaran (golden: makan 2.000.000 / 1.700.000, kesehatan
    // wajib 500.000 / 100.000, kanari 300.000); kategori tanpa anggaran tidak ikut.
    const budgeted = r.budgets.filter((x) => x.budget !== null);
    const sumBudget = budgeted.reduce((a, x) => a + (x.budget ?? 0), 0);
    const sumSpent = budgeted.reduce((a, x) => a + x.spent, 0);
    expect(r.totals).toEqual({
      budget: sumBudget,
      spent: sumSpent,
      remaining: sumBudget - sumSpent,
      pct: Math.floor((sumSpent * 100) / sumBudget),
    });
    expect(r.totals.budget).toBe(2_800_000);
    expect(r.totals.spent).toBe(
      1_800_000 + (r.budgets.find((x) => x.categoryId === fx.ids.kanariCat)?.spent ?? 0),
    );
    // Pengeluaran di kategori induk tanpa anggaran (Cicilan & Tagihan) tidak mengubah total kartu
    // (review ulang Task 10: tanpa ini filter "hanya beranggaran" tidak teruji).
    expect(r.budgets.find((x) => x.categoryId === fx.ids.tagihanCat)?.budget).toBeNull();
    await createEntry(ctx, {
      clientId: randomUUID(),
      accountId: fx.ids.bca,
      kind: 'expense',
      amount: 77_000,
      categoryId: fx.ids.tagihanCat,
      occurredOn: '2026-11-05',
    });
    expect((await loadRencana(ctx)).totals).toEqual(r.totals);

    // Rencana: periode lalu kosong (K13), tagihan + kemunculan, dompet dan kategori ruang ini.
    expect(r.previous).toEqual({
      labelMonth: '2026-10-01',
      budgetCount: 0,
      wajibCount: 0,
      amounts: {},
    });
    expect(r.bills).toMatchObject([
      {
        billId: fx.ids.bill,
        name: KANARI.nTagihan,
        amount: 485_000,
        categoryId: fx.ids.tagihanCat,
        rootCategoryId: fx.ids.tagihanCat,
        accountId: fx.ids.bca,
        accountName: KANARI.nDompet,
        dayOfMonth: 10,
        archived: false,
        nextDueOn: '2026-11-10',
      },
    ]);
    expect(r.due.map((d) => d.dueOn)).toEqual(['2026-11-10']);
    expect(r.accounts.map((a) => a.id)).toContain(fx.ids.bca);
    expect(r.budgets.find((x) => x.categoryId === fx.ids.kesehatan)).toMatchObject({
      budget: 500_000,
      wajib: true,
      spent: 100_000,
      pct: 20,
      remaining: 400_000,
    });
    expect(r.budgets.find((x) => x.categoryId === fx.ids.tagihanCat)).toMatchObject({
      budget: null,
      pct: null,
      remaining: null,
    });
  });

  it('periode lalu berisi anggaran: ringkasan K13; shell layout dipakai ulang', async () => {
    const ctx = await ctxAt(clock.at('2026-11-26T08:00:00+07:00'), fx.n, 'pribadi');
    const shell = { accounts: [], categories: [] };
    const r = await loadRencana(ctx, { shell: Promise.resolve(shell) });
    expect(r.period).toMatchObject({ labelMonth: '2026-12-01', from: '2026-11-25' });
    expect(r.previous).toEqual({
      labelMonth: '2026-11-01',
      budgetCount: 3,
      wajibCount: 1,
      amounts: {
        [fx.ids.makan]: 2_000_000,
        [fx.ids.kesehatan]: 500_000,
        [fx.ids.kanariCat]: 300_000,
      },
    });
    expect(r.budgets.every((x) => x.budget === null)).toBe(true);
    // Periode tanpa anggaran: total nol (bukan galat bagi nol).
    expect(r.totals).toEqual({ budget: 0, spent: 0, remaining: 0, pct: 0 });
    expect(r.accounts).toEqual([]);
  });

  it('total kartu menyertakan kategori terarsip yang masih beranggaran dan realisasinya', async () => {
    const ctx = await ctxAt(clock.at(TODAY), fx.n, 'pribadi');
    const before = (await loadRencana(ctx)).totals;
    // Arsip kategori beranggaran (Kesehatan, wajib, 500.000 / terpakai 100.000): tetap di total.
    await h.admin.query('update app.categories set archived_at = now() where id = $1', [
      fx.ids.kesehatan,
    ]);
    const r = await loadRencana(ctx);
    expect(r.budgets.find((x) => x.categoryId === fx.ids.kesehatan)).toMatchObject({
      archived: true,
      budget: 500_000,
      spent: 100_000,
    });
    expect(r.totals).toEqual(before);
    expect(r.totals.budget).toBe(2_800_000);
  });
});

describe('Anggaran rincian (S10, 0126): subBudgets terpisah, tidak dihitung dua kali', () => {
  it('rincian beranggaran masuk subBudgets, bukan budgets, dan tidak masuk total kartu', async () => {
    const ctx = await ctxAt(clock.at(TODAY), fx.n, 'pribadi');
    const month = GOLDEN.labelMonth.slice(0, 7);
    const before = await loadRencana(ctx);
    const { rows } = await h.admin.query<{ id: string }>(
      `insert into app.categories (space_id, parent_id, type, name, icon)
       values ($1, $2, 'expense', 'Rincian Uji', 'Receipt') returning id`,
      [ctx.spaceId, fx.ids.kesehatan],
    );
    const sub = rows[0]?.id ?? '';
    await setBudget(ctx, { categoryId: sub, month, amount: 100_000, wajib: false });
    const after = await loadRencana(ctx);
    expect(after.budgets.map((b) => b.categoryId)).toEqual(before.budgets.map((b) => b.categoryId));
    expect(after.totals).toEqual(before.totals);
    // Rincian ada di subBudgets: Kesehatan 500.000 wajib, rincian 100.000 -> batas atas 500.000.
    expect(after.subBudgets).toEqual([
      expect.objectContaining({
        categoryId: sub,
        parentId: fx.ids.kesehatan,
        budget: 100_000,
        maxAmount: 500_000,
        subAllocated: null,
      }),
    ]);
    expect(after.budgets.find((b) => b.categoryId === fx.ids.kesehatan)?.subAllocated).toBe(
      100_000,
    );
  });
});

describe('Bersama tanpa data Pribadi [B13]', () => {
  it('Rencana, Laporan, dan Beranda Bersama untuk N dan F tanpa kanari Pribadi [B13]', async () => {
    for (const p of [fx.n, fx.f]) {
      const ctx = await ctxAt(clock.at(TODAY), p, 'bersama');
      const data = {
        rencana: await loadRencana(ctx),
        laporan: await loadLaporan(ctx),
        beranda: await loadBeranda(ctx),
      };
      const blob = JSON.stringify(data);
      for (const k of [
        KANARI.nTagihan,
        KANARI.nKategori,
        KANARI.nDompet,
        KANARI.fTagihan,
        KANARI.fDompet,
        fx.ids.bca,
        fx.ids.bill,
        fx.ids.fBill,
        fx.ids.kanariCat,
      ]) {
        expect(blob).not.toContain(k);
      }
      expect(memuatNominal(data, KANARI.nRp)).toBe(false);
      expect(memuatNominal(data, KANARI.fRp)).toBe(false);
      expect(data.laporan.summary.pengeluaran).toBe(GOLDEN.bersamaBelanja);
      expect(data.laporan.contributions?.rows.map((r) => r.setoran)).toEqual([
        GOLDEN.bersamaSetor,
        0,
      ]);
      // Sub `Sayur & Buah` menambah induk `Belanja Dapur`.
      expect(
        data.laporan.categories.find((c) => c.kind === 'category' && c.name === 'Belanja Dapur'),
      ).toMatchObject({ rootTotal: GOLDEN.bersamaBelanja, amount: 0 });
    }
  });

  it('Luar dan ruang Pribadi pasangan: DK404 (not_found)', async () => {
    const nP = await ctxAt(clock.at(TODAY), fx.n, 'pribadi');
    // F memakai id ruang Pribadi N lewat konteks rakitan: assert_member menolak.
    const forged = { ...nP, userId: fx.f.id };
    for (const load of [
      () => loadRencana(forged),
      () => loadLaporan(forged),
      () => loadBeranda(forged),
    ]) {
      expect(toLedgerError(await failure(load()))).toEqual({ code: 'not_found' });
    }
    const luar = { ...nP, userId: fx.luar.id };
    expect(toLedgerError(await failure(loadRencana(luar)))).toEqual({ code: 'not_found' });
    expect(toLedgerError(await failure(loadLaporan(luar)))).toEqual({ code: 'not_found' });
  });
});
