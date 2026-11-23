import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withUser } from '../../db';
import { loadAktivitas } from '../bersama';
import { exportLaporanCsv } from '../ekspor';
import { toLedgerError } from '../errors';
import { createSplit } from '../patungan';
import { listTripChoices, monthSummary, safeToSpend } from '../read';
import { resolveSpace } from '../space';
import {
  archiveTrip,
  createTrip,
  loadTripDetail,
  loadTrips,
  restoreTrip,
  setEntriesTrip,
  updateTrip,
} from '../trip';
import { createAccount, createEntry, updateEntry, voidEntry, type LedgerCtx } from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * S15 Task 6: loader dan wrapper trip atas Postgres nyata (persona N pemilik, F anggota Bersama).
 * Tag `[B25]`: trip Pribadi (nama, angka, entri) tidak terbaca atau tertulis oleh pasangan atau dari
 * rute Bersama; `[I6]`: trip hanya pengelompokan (ringkasan bulan, "aman dipakai", Σ ekspor tidak
 * berubah oleh membuat/menandai/melepas/mengarsipkan; total trip = SQL, bigint aman); K1: anggota kedua
 * Bersama boleh menulis; K16: feed Aktivitas tidak dibanjiri tanda saja. SQL-nya diuji pgTAP (44–46).
 */

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<LedgerCtx> {
  const { spaceId } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId };
}

async function categoryOf(spaceId: string): Promise<string> {
  const { rows } = await h.admin.query<{ id: string }>(
    `select id from app.categories
      where space_id = $1 and type = 'expense' and parent_id is null and archived_at is null
      order by sort_order limit 1`,
    [spaceId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('kategori awal tidak ada');
  return id;
}

const wallet = async (
  ctx: LedgerCtx,
  name: string,
  openingBalance: number,
  pocket: 'operasional' | 'kantor' = 'operasional',
) =>
  (
    await createAccount(ctx, {
      clientId: randomUUID(),
      name,
      pocket,
      walletType: 'bank',
      openingBalance,
    })
  ).accountId;

const fail = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => {
      throw new Error('seharusnya gagal');
    },
    (e: unknown) => e,
  );
/** Kode UI dari galat yang dilempar wrapper (pemetaan sama dengan Server Action). */
const codeOf = async (p: Promise<unknown>) => toLedgerError(await p)?.code;

const CANARY = 'Trip Rahasia Kanari 7391';

describe('trip (S15 Task 6)', () => {
  let n: Persona;
  let f: Persona;
  let nPribadi: LedgerCtx;
  let fPribadi: LedgerCtx;
  let nBersama: LedgerCtx;
  let fBersama: LedgerCtx;
  let bca: string;
  let catP: string;
  let catB: string;
  let today: string;
  let range: { startsOn: string; endsOn: string };

  const trip = (ctx: LedgerCtx, name: string, over: Record<string, unknown> = {}) =>
    createTrip(ctx, { clientId: randomUUID(), name, ...range, ...over });
  const spend = (ctx: LedgerCtx, accountId: string, amount: number, over = {}) =>
    createEntry(ctx, {
      clientId: randomUUID(),
      accountId,
      kind: 'expense',
      amount,
      categoryId: ctx === nPribadi || ctx === fPribadi ? catP : catB,
      ...over,
    });

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    if (!ps.f) throw new Error('persona kurang');
    n = ps.n;
    f = ps.f;
    nPribadi = await ctxOf(n, 'pribadi');
    fPribadi = await ctxOf(f, 'pribadi');
    nBersama = await ctxOf(n, 'bersama');
    fBersama = await ctxOf(f, 'bersama');
    catP = await categoryOf(nPribadi.spaceId);
    catB = await categoryOf(nBersama.spaceId);
    bca = await wallet(nPribadi, 'BCA', 20_000_000);
    const { rows } = await h.admin.query<{ t: string; y: string; e: string }>(
      `select app.today()::text as t, (app.today() - 1)::text as y, (app.today() + 5)::text as e`,
    );
    today = rows[0]?.t ?? '';
    range = { startsOn: rows[0]?.y ?? '', endsOn: rows[0]?.e ?? '' };
  });

  it('daftar kosong; buat; detail: total, rincian, kandidat, entri dari SQL', async () => {
    expect(await loadTrips(nPribadi)).toEqual([]);
    const { tripId, replayed } = await trip(nPribadi, 'Bali', { budget: 1_000_000 });
    expect(replayed).toBe(false);

    const [t0] = await loadTrips(nPribadi);
    expect(t0).toMatchObject({
      id: tripId,
      name: 'Bali',
      budget: 1_000_000,
      archived: false,
      phase: 'ongoing',
      dayCount: 7,
      spent: 0,
      entryCount: 0,
      budgetLeft: 1_000_000,
    });

    const a = await spend(nPribadi, bca, 100_000, { tripId, description: 'tiket' });
    const b = await spend(nPribadi, bca, 250_000, { tripId, description: 'hotel' });
    const lepas = await spend(nPribadi, bca, 40_000, { description: 'kopi' });

    const d = await loadTripDetail(nPribadi, tripId);
    if (d === null) throw new Error('detail kosong');
    expect(d.trip).toMatchObject({
      id: tripId,
      spent: 350_000,
      entryCount: 2,
      budgetLeft: 650_000,
      pct: 35,
      elapsedDays: 2,
      perDay: 175_000,
      firstEntryOn: today,
      lastEntryOn: today,
    });
    // Rincian dari SQL: Σ per dimensi = total; label kategori dari DB.
    for (const dim of ['category', 'day'] as const) {
      expect(d.breakdown[dim].reduce((s, r) => s + r.amount, 0)).toBe(350_000);
      expect(d.breakdown[dim].reduce((s, r) => s + r.entryCount, 0)).toBe(2);
    }
    expect(d.breakdown.day).toEqual([{ key: today, label: today, amount: 350_000, entryCount: 2 }]);
    expect(d.breakdown.member).toEqual([
      { key: n.id, label: n.name, amount: 350_000, entryCount: 2, isMe: true },
    ]);
    // Daftar pengeluaran trip = entri bertanda saja, terbaru dulu; amount positif.
    expect(d.entries.map((e) => e.id).sort()).toEqual([a.entryId, b.entryId].sort());
    expect(d.entries.every((e) => e.tripId === tripId && e.tripName === 'Bali')).toBe(true);
    expect(d.entries.reduce((s, e) => s + e.amount, 0)).toBe(350_000);
    expect(d.entriesTruncated).toBe(false);
    expect(d.memberCount).toBe(1);
    // Kandidat: pengeluaran biasa tanpa trip dalam rentang.
    expect(d.candidates.map((c) => c.entryId)).toEqual([lepas.entryId]);
    expect(d.candidates[0]).toMatchObject({
      description: 'kopi',
      accountName: 'BCA',
      amount: 40_000,
      occurredOn: today,
    });
    expect(d.candidatesMore).toBe(false);
  });

  it('set_entries_trip memasukkan kandidat; melepas; replay clientId sama = nilai sama', async () => {
    const { tripId } = await trip(nPribadi, 'Bali');
    const e1 = await spend(nPribadi, bca, 10_000);
    const e2 = await spend(nPribadi, bca, 20_000);
    const clientId = randomUUID();
    await expect(
      setEntriesTrip(nPribadi, { clientId, tripId, entryIds: [e1.entryId, e2.entryId] }),
    ).resolves.toEqual({ changed: 2, replayed: false });
    await expect(
      setEntriesTrip(nPribadi, { clientId, tripId, entryIds: [e1.entryId, e2.entryId] }),
    ).resolves.toEqual({ changed: 2, replayed: true });
    // Sudah sesuai = 0 berubah.
    await expect(
      setEntriesTrip(nPribadi, { clientId: randomUUID(), tripId, entryIds: [e1.entryId] }),
    ).resolves.toEqual({ changed: 0, replayed: false });
    expect((await loadTripDetail(nPribadi, tripId))?.trip.spent).toBe(30_000);
    expect((await loadTripDetail(nPribadi, tripId))?.candidates).toEqual([]);
    await expect(
      setEntriesTrip(nPribadi, { clientId: randomUUID(), tripId: null, entryIds: [e1.entryId] }),
    ).resolves.toMatchObject({ changed: 1 });
    expect((await loadTripDetail(nPribadi, tripId))?.trip).toMatchObject({
      spent: 20_000,
      entryCount: 1,
    });
  });

  it('[B25] trip Pribadi tidak terbaca atau tertulis oleh pasangan atau dari rute Bersama', async () => {
    const { tripId } = await trip(nPribadi, CANARY);
    const e = await spend(nPribadi, bca, 10_000, { tripId });

    // Terbaca hanya di ruang pemilik: pasangan (Pribadi-nya), rute Bersama, dan id bukan uuid = null.
    expect(await loadTripDetail(fPribadi, tripId)).toBeNull();
    expect(await loadTripDetail(nBersama, tripId)).toBeNull();
    expect(await loadTripDetail(fBersama, tripId)).toBeNull();
    expect(await loadTripDetail(nPribadi, 'bukan-uuid')).toBeNull();
    expect(await loadTripDetail(nPribadi, randomUUID())).toBeNull();
    for (const ctx of [fPribadi, nBersama, fBersama]) {
      expect(await loadTrips(ctx)).toEqual([]);
      expect(JSON.stringify(await listTripChoices(ctx))).not.toContain(CANARY);
    }
    expect(await loadTrips(nPribadi)).toHaveLength(1);

    // Tulis: semua jalur menolak seragam `not_found` (tanpa orakel nama).
    const range2 = { name: 'X', startsOn: range.startsOn, endsOn: range.endsOn, budget: null };
    for (const ctx of [fPribadi, nBersama, fBersama]) {
      expect(await codeOf(fail(updateTrip(ctx, { tripId, ...range2 })))).toBe('not_found');
      expect(await codeOf(fail(archiveTrip(ctx, { tripId })))).toBe('not_found');
      expect(await codeOf(fail(restoreTrip(ctx, { tripId })))).toBe('not_found');
      expect(
        await codeOf(
          fail(setEntriesTrip(ctx, { clientId: randomUUID(), tripId, entryIds: [e.entryId] })),
        ),
      ).toBe('not_found');
      expect(
        await codeOf(
          fail(
            setEntriesTrip(ctx, { clientId: randomUUID(), tripId: null, entryIds: [e.entryId] }),
          ),
        ),
      ).toBe('not_found');
    }
    // Menandai entri Bersama ke trip Pribadi (dan sebaliknya) ditolak sebelum DB.
    const wB = await wallet(nBersama, 'Kas Bersama', 5_000_000);
    expect(await codeOf(fail(spend(nBersama, wB, 1_000, { tripId })))).toBe('not_found');
    const { tripId: tripB } = await trip(nBersama, 'Trip Bersama');
    expect(await codeOf(fail(spend(nPribadi, bca, 1_000, { tripId: tripB })))).toBe('not_found');
    // Kanari tidak ada di data apa pun yang sampai ke pasangan.
    expect(JSON.stringify(await loadTrips(fBersama))).not.toContain(CANARY);
    // Tidak ada yang berubah di trip pemilik.
    expect((await loadTripDetail(nPribadi, tripId))?.trip).toMatchObject({
      name: CANARY,
      entryCount: 1,
      archived: false,
    });
  });

  it('K1: anggota kedua Bersama membaca dan menulis (buat, tandai, ubah, arsip, pulih); Pribadi F terpisah', async () => {
    const wB = await wallet(nBersama, 'Kas Bersama', 5_000_000);
    const { tripId } = await trip(nBersama, 'Lombok');
    const d = await loadTripDetail(fBersama, tripId);
    expect(d?.trip.name).toBe('Lombok');
    expect(d?.memberCount).toBe(2);
    const e = await spend(fBersama, wB, 55_000, { tripId });
    const after = await loadTripDetail(nBersama, tripId);
    expect(after?.trip).toMatchObject({ spent: 55_000, entryCount: 1 });
    expect(after?.breakdown.member).toEqual([
      { key: f.id, label: f.name, amount: 55_000, entryCount: 1 },
    ]);
    // `isMe` menurut pengguna yang melihat.
    expect((await loadTripDetail(fBersama, tripId))?.breakdown.member[0]?.isMe).toBe(true);
    await expect(
      updateTrip(fBersama, {
        tripId,
        name: 'Lombok 2',
        ...range,
        budget: 2_000_000,
      }),
    ).resolves.toEqual({ tripId });
    await expect(archiveTrip(nBersama, { tripId })).resolves.toEqual({ tripId, archived: true });
    await expect(restoreTrip(fBersama, { tripId })).resolves.toEqual({ tripId, archived: false });
    await expect(
      setEntriesTrip(nBersama, { clientId: randomUUID(), tripId: null, entryIds: [e.entryId] }),
    ).resolves.toMatchObject({ changed: 1 });
    // Pribadi F tidak melihat apa pun dari trip Bersama.
    expect(await loadTrips(fPribadi)).toEqual([]);
  });

  it('[I6] trip hanya pengelompokan: ringkasan bulan, aman dipakai, Σ ekspor tidak berubah', async () => {
    const e1 = await spend(nPribadi, bca, 10_000);
    const e2 = await spend(nPribadi, bca, 25_000);
    const e3 = await spend(nPribadi, bca, 7_500);
    const month = today.slice(0, 7);
    const snapshot = async () => {
      const csv = await exportLaporanCsv({ ...nPribadi, kind: 'personal' });
      return JSON.stringify({
        month: await monthSummary(nPribadi, month),
        safe: await safeToSpend(nPribadi),
        csvAmounts: csv.rows.map((r) => [r.occurredOn, r.reportClass, r.amount]).sort(),
      });
    };
    const base = await snapshot();
    const baseSummary = await monthSummary(nPribadi, month);
    expect(baseSummary.pengeluaran).toBe(42_500);

    const { tripId } = await trip(nPribadi, 'Bali', { budget: 40_000 });
    expect(await snapshot()).toBe(base);
    await setEntriesTrip(nPribadi, {
      clientId: randomUUID(),
      tripId,
      entryIds: [e1.entryId, e2.entryId, e3.entryId],
    });
    // Total trip = "Pengeluaran" bulan ini (satu sumber), bukan hitungan lain.
    const d = await loadTripDetail(nPribadi, tripId);
    expect(d?.trip.spent).toBe(baseSummary.pengeluaran);
    expect(d?.trip).toMatchObject({ budgetLeft: -2_500, pct: 106 });
    expect(await snapshot()).toBe(base);
    await updateTrip(nPribadi, { tripId, name: 'Bali 2', ...range, budget: null });
    expect(await snapshot()).toBe(base);
    await archiveTrip(nPribadi, { tripId });
    expect(await snapshot()).toBe(base);
    expect((await loadTripDetail(nPribadi, tripId))?.trip.spent).toBe(42_500);
    await restoreTrip(nPribadi, { tripId });
    await setEntriesTrip(nPribadi, {
      clientId: randomUUID(),
      tripId: null,
      entryIds: [e1.entryId, e2.entryId, e3.entryId],
    });
    expect(await snapshot()).toBe(base);
    expect((await loadTripDetail(nPribadi, tripId))?.trip).toMatchObject({
      spent: 0,
      entryCount: 0,
      perDay: null,
    });
  });

  it('K4: Kantor, talangan, pemasukan, dan entri batal tidak masuk total atau kandidat', async () => {
    const kantor = await wallet(nPribadi, 'Kantor', 5_000_000, 'kantor');
    const { tripId } = await trip(nPribadi, 'Dinas');
    const ok = await spend(nPribadi, bca, 30_000, { tripId });
    const dibatal = await spend(nPribadi, bca, 99_000, { tripId });
    await voidEntry(nPribadi, {
      clientId: randomUUID(),
      entryId: dibatal.entryId,
      expectedVersion: 1,
    });
    const tal = await spend(nPribadi, bca, 5_000, { reimbursable: true });
    const kan = await spend(nPribadi, kantor, 6_000);
    // Penjaga bentuk: kantor/talangan/pemasukan bertrip ditolak sebelum CHECK.
    expect(await codeOf(fail(spend(nPribadi, kantor, 1_000, { tripId })))).toBe(
      'trip_entry_invalid',
    );
    expect(await codeOf(fail(spend(nPribadi, bca, 1_000, { tripId, reimbursable: true })))).toBe(
      'trip_entry_invalid',
    );
    const { rows } = await h.admin.query<{ id: string }>(
      `select id from app.categories where space_id = $1 and type = 'income' and parent_id is null
        and archived_at is null limit 1`,
      [nPribadi.spaceId],
    );
    expect(
      await codeOf(
        fail(spend(nPribadi, bca, 1_000, { tripId, kind: 'income', categoryId: rows[0]?.id })),
      ),
    ).toBe('trip_entry_invalid');
    const d = await loadTripDetail(nPribadi, tripId);
    expect(d?.trip).toMatchObject({ spent: 30_000, entryCount: 1 });
    expect(d?.entries.map((e) => e.id)).toEqual([ok.entryId]);
    expect(d?.candidates).toEqual([]);
    // Kandidat tidak memuat talangan, Kantor, atau yang batal; menandainya ditolak atomik.
    expect(
      await codeOf(
        fail(
          setEntriesTrip(nPribadi, {
            clientId: randomUUID(),
            tripId,
            entryIds: [tal.entryId, kan.entryId],
          }),
        ),
      ),
    ).toBe('trip_entry_invalid');
    expect(
      await codeOf(
        fail(
          setEntriesTrip(nPribadi, {
            clientId: randomUUID(),
            tripId,
            entryIds: [dibatal.entryId],
          }),
        ),
      ),
    ).toBe('conflict');
  });

  it('trip terarsip: daftar tetap, kandidat kosong, tidak bisa diubah/dipilih baru; melepas boleh', async () => {
    const { tripId } = await trip(nPribadi, 'Lama');
    const e = await spend(nPribadi, bca, 10_000, { tripId });
    const lain = await spend(nPribadi, bca, 3_000);
    await archiveTrip(nPribadi, { tripId });
    const [t] = await loadTrips(nPribadi);
    expect(t).toMatchObject({ archived: true, spent: 10_000 });
    const d = await loadTripDetail(nPribadi, tripId);
    expect(d?.trip.archived).toBe(true);
    expect(d?.candidates).toEqual([]);
    expect(await listTripChoices(nPribadi)).toEqual([]);
    expect(
      await codeOf(fail(updateTrip(nPribadi, { tripId, name: 'X', ...range, budget: null }))),
    ).toBe('trip_archived');
    expect(
      await codeOf(
        fail(
          setEntriesTrip(nPribadi, { clientId: randomUUID(), tripId, entryIds: [lain.entryId] }),
        ),
      ),
    ).toBe('trip_archived');
    expect(await codeOf(fail(spend(nPribadi, bca, 1_000, { tripId })))).toBe('trip_archived');
    await expect(
      setEntriesTrip(nPribadi, { clientId: randomUUID(), tripId: null, entryIds: [e.entryId] }),
    ).resolves.toMatchObject({ changed: 1 });
  });

  it('nama aktif unik: dua create paralel = satu name_taken; ubah/pulih bentrok = name_taken; batas 200', async () => {
    const results = await Promise.allSettled([trip(nPribadi, 'Bali'), trip(nPribadi, ' bali ')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(toLedgerError(rejected?.status === 'rejected' ? rejected.reason : null)?.code).toBe(
      'name_taken',
    );

    const [aktif] = await loadTrips(nPribadi);
    if (!aktif) throw new Error('trip kosong');
    await archiveTrip(nPribadi, { tripId: aktif.id });
    const { tripId: baru } = await trip(nPribadi, 'Bali');
    expect(await codeOf(fail(restoreTrip(nPribadi, { tripId: aktif.id })))).toBe('name_taken');
    const { tripId: lain } = await trip(nPribadi, 'Jawa');
    expect(
      await codeOf(
        fail(updateTrip(nPribadi, { tripId: lain, name: 'BALI', ...range, budget: null })),
      ),
    ).toBe('name_taken');
    // Nama yang sama di ruang lain bukan bentrok.
    await expect(trip(nBersama, 'Bali')).resolves.toMatchObject({ replayed: false });
    expect(baru).toBeTruthy();
  });

  it('tanggal/nama/anggaran buruk ditolak (Zod sebelum DB); tanggal valid Zod tapi salah DB = invalid kolom', async () => {
    for (const over of [
      { name: ' ' },
      { startsOn: '2026-02-30' },
      { endsOn: '2020-01-01' },
      { budget: 0 },
    ]) {
      await expect(trip(nPribadi, 'X', over)).rejects.toThrow();
    }
    expect(await loadTrips(nPribadi)).toEqual([]);
    // Karakter kontrol di nama: lolos Zod (trim JS tidak membuangnya di tengah), DB menolak kolom `name`.
    const e = toLedgerError(await fail(trip(nPribadi, 'Ba\nli')));
    expect(e).toEqual({ code: 'invalid', field: 'name' });
  });

  it('bigint aman: total puluhan triliun tetap persis, tanpa pembulatan', async () => {
    const wallets = await Promise.all(
      ['A', 'B', 'C'].map((x) => wallet(nPribadi, `Besar ${x}`, 10 ** 13)),
    );
    const { tripId } = await trip(nPribadi, 'Besar', { budget: 10 ** 13 });
    for (const acc of wallets) await spend(nPribadi, acc, 10 ** 13, { tripId });
    const d = await loadTripDetail(nPribadi, tripId);
    expect(d?.trip).toMatchObject({
      spent: 3 * 10 ** 13,
      entryCount: 3,
      budgetLeft: -2 * 10 ** 13,
      pct: 300,
    });
    expect(Number.isSafeInteger(d?.trip.spent)).toBe(true);
    expect(d?.breakdown.category.reduce((s, r) => s + r.amount, 0)).toBe(3 * 10 ** 13);
    const [t] = await loadTrips(nPribadi);
    expect(t?.spent).toBe(3 * 10 ** 13);
  });

  it('K16: menandai tanpa mengubah hal lain tidak membanjiri feed Aktivitas; ubah nominal tetap tampil', async () => {
    const wB = await wallet(nBersama, 'Kas Bersama', 5_000_000);
    const { tripId } = await trip(nBersama, 'Lombok');
    const e = await spend(nBersama, wB, 20_000);
    const countFeed = async () =>
      (await loadAktivitas({ ...fBersama, kind: 'shared' })).items.length;
    const before = await countFeed();
    await setEntriesTrip(nBersama, { clientId: randomUUID(), tripId, entryIds: [e.entryId] });
    expect(await countFeed()).toBe(before);
    await setEntriesTrip(nBersama, { clientId: randomUUID(), tripId: null, entryIds: [e.entryId] });
    expect(await countFeed()).toBe(before);
    await updateEntry(nBersama, {
      clientId: randomUUID(),
      entryId: e.entryId,
      expectedVersion: 3,
      accountId: wB,
      amount: 21_000,
      categoryId: catB,
      occurredOn: null,
      description: null,
      reimbursable: false,
      tripId: null,
    });
    expect(await countFeed()).toBe(before + 1);
  });

  it('pilihan Catat: aktif, jendela 30 hari, maks 20, hanya ruang ini', async () => {
    const days = async (a: number, b: number) =>
      (
        await h.admin.query<{ s: string; e: string }>(
          'select (app.today() + $1::int)::text as s, (app.today() + $2::int)::text as e',
          [a, b],
        )
      ).rows[0];
    const lampau = await days(-60, -31); // berakhir 31 hari lalu: di luar jendela
    const batas = await days(-40, -30); // berakhir tepat 30 hari lalu: masuk
    const depan = await days(10, 12);
    const mk = (name: string, d: typeof lampau) =>
      trip(nPribadi, name, { startsOn: d?.s, endsOn: d?.e });
    await mk('Lampau', lampau);
    await mk('Batas', batas);
    await mk('Depan', depan);
    const { tripId: arsip } = await trip(nPribadi, 'Arsip');
    await archiveTrip(nPribadi, { tripId: arsip });
    await trip(nBersama, CANARY);
    const pilihan = await listTripChoices(nPribadi);
    expect(pilihan.map((t) => t.name)).toEqual(['Depan', 'Batas']);
    expect(pilihan[0]).toEqual({
      id: expect.any(String) as unknown,
      name: 'Depan',
      startsOn: depan?.s,
      endsOn: depan?.e,
    });
    expect(JSON.stringify(pilihan)).not.toContain(CANARY);
    // Maks 20: 25 trip aktif berjalan = 20 terbaru mulai.
    for (let i = 0; i < 25; i += 1) {
      await trip(nPribadi, `Massal ${String(i).padStart(2, '0')}`);
    }
    expect(await listTripChoices(nPribadi)).toHaveLength(20);
  });

  it('bagi tagihan ke trip Bersama (K6): pengeluaran patungan masuk total; dilepas = split_locked', async () => {
    const { tripId } = await trip(nBersama, 'Makan malam');
    const r = await createSplit(nBersama, {
      clientId: randomUUID(),
      accountId: bca,
      amount: 90_000,
      categoryId: catB,
      tripId,
    });
    const d = await loadTripDetail(fBersama, tripId);
    expect(d?.trip).toMatchObject({ spent: 90_000, entryCount: 1 });
    expect(d?.entries[0]).toMatchObject({ id: r.expenseEntryId, tripId });
    expect(d?.entries[0]?.split?.role).toBe('bill');
    // Dicatat atas nama pembayar (N), bukan F.
    expect(d?.breakdown.member).toEqual([
      { key: n.id, label: n.name, amount: 90_000, entryCount: 1 },
    ]);
    expect(
      await codeOf(
        fail(
          setEntriesTrip(fBersama, {
            clientId: randomUUID(),
            tripId: null,
            entryIds: [r.expenseEntryId],
          }),
        ),
      ),
    ).toBe('split_locked');
    // Kandidat tidak pernah memuat entri patungan.
    const { tripId: t2 } = await trip(nBersama, 'Lain');
    expect((await loadTripDetail(nBersama, t2))?.candidates).toEqual([]);
    // Trip Pribadi untuk tagihan Bersama ditolak sebelum DB.
    const pribadiTrip = await trip(nPribadi, 'Pribadi');
    expect(
      await codeOf(
        fail(
          createSplit(nBersama, {
            clientId: randomUUID(),
            accountId: bca,
            amount: 1_000,
            categoryId: catB,
            tripId: pribadiTrip.tripId,
          }),
        ),
      ),
    ).toBe('not_found');
  });

  it('space_mismatch dari DB (jalur tanpa pra-cek wrapper): entri Pribadi ke trip Bersama ditolak', async () => {
    const { tripId } = await trip(nBersama, 'Lombok');
    const e = await spend(nPribadi, bca, 5_000);
    const err = await fail(
      withUser(h.pools.app, n.id, (c) =>
        c.query('select api.set_entries_trip($1, $2, $3::uuid[])', [
          randomUUID(),
          tripId,
          [e.entryId],
        ]),
      ),
    );
    expect((err as { code?: string; message?: string }).message).toBe('space_mismatch');
    expect((err as { code?: string }).code).toBe('DK422');
  });
});
