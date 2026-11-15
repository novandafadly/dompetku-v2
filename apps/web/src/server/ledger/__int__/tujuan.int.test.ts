import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { toLedgerError } from '../errors';
import { listAccounts } from '../read';
import { resolveSpace } from '../space';
import {
  archiveGoal,
  completeGoal,
  createGoal,
  loadTujuan,
  restoreGoal,
  updateGoal,
} from '../tujuan';
import {
  createAccount,
  createSpaceTransfer,
  createTransfer,
  restoreEntry,
  voidEntry,
  type LedgerCtx,
} from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * S13 Task 4: tujuan tabungan lewat loader/wrapper server atas Postgres nyata (persona N pemilik,
 * F anggota Bersama, Luar tanpa ruang). Tag `[T11]` = butir K9 yang dibuktikan di server: (a) dua
 * `create_goal` paralel pada dompet sama = satu `goal_exists`, (b) progres bergeser tepat sekali
 * oleh transfer/void/restore dan setor lintas ruang, (e) tujuan Pribadi pasangan tidak terbaca atau
 * tertulis; K1: anggota kedua Bersama boleh menulis. SQL-nya sendiri diuji pgTAP (35/36).
 */

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<LedgerCtx> {
  const { spaceId } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId };
}

const wallet = async (
  ctx: LedgerCtx,
  name: string,
  pocket: 'operasional' | 'tabungan' | 'kantor',
  openingBalance = 0,
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

const goalOf = (ctx: LedgerCtx, accountId: string, over: Record<string, unknown> = {}) =>
  createGoal(ctx, {
    clientId: randomUUID(),
    accountId,
    name: 'Dana darurat',
    target: 10_000_000,
    ...over,
  });

const move = (ctx: LedgerCtx, from: string, to: string, amount: number) =>
  createTransfer(ctx, { clientId: randomUUID(), fromAccountId: from, toAccountId: to, amount });

const codeOf = (e: unknown) => toLedgerError(e)?.code;

describe('tujuan tabungan (S13 Task 4)', () => {
  let n: Persona;
  let f: Persona;
  let luar: Persona;
  let nPribadi: LedgerCtx;
  let fPribadi: LedgerCtx;
  let bersama: LedgerCtx;
  let fBersama: LedgerCtx;
  let bca: string;
  let tab: string;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung', luar: true });
    if (!ps.f || !ps.luar) throw new Error('persona kurang');
    n = ps.n;
    f = ps.f;
    luar = ps.luar;
    nPribadi = await ctxOf(n, 'pribadi');
    fPribadi = await ctxOf(f, 'pribadi');
    bersama = await ctxOf(n, 'bersama');
    fBersama = await ctxOf(f, 'bersama');
    bca = await wallet(nPribadi, 'BCA', 'operasional', 20_000_000);
    tab = await wallet(nPribadi, 'Tabungan BCA', 'tabungan', 1_000_000);
  });

  it('daftar kosong; sesudah buat: progres dari SQL, tanpa nama pembuat di Pribadi', async () => {
    expect(await loadTujuan(nPribadi)).toEqual({ goals: [], partnerName: null });
    const { goalId, replayed } = await goalOf(nPribadi, tab, { targetOn: '2099-12-25' });
    expect(replayed).toBe(false);
    const { goals, partnerName } = await loadTujuan(nPribadi);
    expect(partnerName).toBeNull();
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      goalId,
      name: 'Dana darurat',
      accountId: tab,
      accountName: 'Tabungan BCA',
      accountArchived: false,
      status: 'active',
      target: 10_000_000,
      targetOn: '2099-12-25',
      balance: 1_000_000,
      saved: 1_000_000,
      remaining: 9_000_000,
      pct: 10,
      reached: false,
      createdByName: null,
      accountHasOtherActive: false,
    });
    expect(goals[0]?.periodsLeft).toBeGreaterThan(1);
    expect(goals[0]?.perPeriod).toBeGreaterThan(0);
  });

  it('[T11] progres bergeser tepat sekali oleh transfer, void, dan restore; saldo dompet tidak dihitung ulang di TS', async () => {
    await goalOf(nPribadi, tab);
    const t = await move(nPribadi, bca, tab, 4_000_000);
    let g = (await loadTujuan(nPribadi)).goals[0];
    expect(g).toMatchObject({
      balance: 5_000_000,
      saved: 5_000_000,
      pct: 50,
      remaining: 5_000_000,
    });
    await voidEntry(nPribadi, {
      clientId: randomUUID(),
      entryId: t.entryId,
      expectedVersion: t.version,
    });
    g = (await loadTujuan(nPribadi)).goals[0];
    expect(g).toMatchObject({ balance: 1_000_000, pct: 10 });
    await restoreEntry(nPribadi, {
      clientId: randomUUID(),
      entryId: t.entryId,
      expectedVersion: t.version + 1,
    });
    g = (await loadTujuan(nPribadi)).goals[0];
    expect(g).toMatchObject({ balance: 5_000_000, pct: 50 });
  });

  it('melebihi target: tercapai, bilah penuh, tanpa sisa; saldo minus = progres 0', async () => {
    await goalOf(nPribadi, tab, { target: 1_000_000 });
    expect((await loadTujuan(nPribadi)).goals[0]).toMatchObject({
      reached: true,
      pct: 100,
      remaining: 0,
      perPeriod: null,
    });
    const kecil = await wallet(nPribadi, 'Tabungan Kecil', 'tabungan', 0);
    await goalOf(nPribadi, kecil, { name: 'Kecil', target: 500_000 });
    await createTransfer(nPribadi, {
      clientId: randomUUID(),
      fromAccountId: kecil,
      toAccountId: bca,
      amount: 100_000,
      allowNegative: true,
    });
    const g = (await loadTujuan(nPribadi)).goals.find((x) => x.name === 'Kecil');
    expect(g).toMatchObject({
      balance: -100_000,
      saved: 0,
      pct: 0,
      remaining: 600_000,
      reached: false,
    });
  });

  it('[T11] dua create_goal paralel pada dompet yang sama: satu berhasil, satu goal_exists', async () => {
    const [a, b] = await Promise.allSettled([
      goalOf(nPribadi, tab),
      goalOf(nPribadi, tab, { name: 'Lain' }),
    ]);
    const ok = [a, b].filter((r) => r.status === 'fulfilled');
    const bad = [a, b].filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(codeOf(bad[0]?.reason)).toBe('goal_exists');
    expect((await loadTujuan(nPribadi)).goals).toHaveLength(1);
  });

  it('create idempoten: clientId sama = replayed, satu tujuan', async () => {
    const clientId = randomUUID();
    const first = await goalOf(nPribadi, tab, { clientId });
    const again = await goalOf(nPribadi, tab, { clientId });
    expect(again).toEqual({ goalId: first.goalId, replayed: true });
    expect((await loadTujuan(nPribadi)).goals).toHaveLength(1);
  });

  it('dompet bukan tabungan ditolak (goal_pocket_invalid) di kedua ruang', async () => {
    await expect(goalOf(nPribadi, bca)).rejects.toSatisfy(
      (e) => codeOf(e) === 'goal_pocket_invalid',
    );
    const kas = await wallet(bersama, 'Kas', 'operasional');
    await expect(goalOf(bersama, kas)).rejects.toSatisfy(
      (e) => codeOf(e) === 'goal_pocket_invalid',
    );
  });

  it('tanggal target lampau ditolak, tanggal di atas 2100-12-31 ditolak Zod sebelum DB', async () => {
    await expect(goalOf(nPribadi, tab, { targetOn: '2020-01-01' })).rejects.toSatisfy(
      (e) => codeOf(e) === 'goal_target_past',
    );
    await expect(goalOf(nPribadi, tab, { targetOn: '2101-01-01' })).rejects.toThrow();
  });

  it('ubah: nama, target, hapus tanggal; tujuan tidak aktif = goal_not_active', async () => {
    const { goalId } = await goalOf(nPribadi, tab, { targetOn: '2099-12-25' });
    await updateGoal(nPribadi, { goalId, name: 'Dana baru', target: 20_000_000, targetOn: null });
    expect((await loadTujuan(nPribadi)).goals[0]).toMatchObject({
      name: 'Dana baru',
      target: 20_000_000,
      targetOn: null,
      periodsLeft: null,
      perPeriod: null,
    });
    await archiveGoal(nPribadi, { goalId });
    await expect(
      updateGoal(nPribadi, { goalId, name: 'X', target: 5, targetOn: null }),
    ).rejects.toSatisfy((e) => codeOf(e) === 'goal_not_active');
  });

  it('selesaikan: belum tercapai = goal_not_reached; tercapai = selesai, dompet bebas untuk tujuan baru, pulihkan lama = goal_exists', async () => {
    const { goalId } = await goalOf(nPribadi, tab);
    await expect(completeGoal(nPribadi, { goalId })).rejects.toSatisfy(
      (e) => codeOf(e) === 'goal_not_reached',
    );
    await move(nPribadi, bca, tab, 9_000_000);
    expect((await loadTujuan(nPribadi)).goals[0]).toMatchObject({ reached: true, pct: 100 });
    await expect(completeGoal(nPribadi, { goalId })).resolves.toMatchObject({
      status: 'completed',
    });
    const done = (await loadTujuan(nPribadi)).goals[0];
    expect(done).toMatchObject({ status: 'completed' });
    expect(done?.completedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const baru = await goalOf(nPribadi, tab, { name: 'Tujuan baru', target: 50_000_000 });
    await expect(restoreGoal(nPribadi, { goalId })).rejects.toSatisfy(
      (e) => codeOf(e) === 'goal_exists',
    );
    const list = (await loadTujuan(nPribadi)).goals;
    // Aktif dulu, lalu selesai; yang selesai dibuka-kunci Pulihkan-nya terhalang oleh tujuan aktif lain.
    expect(list.map((g) => g.status)).toEqual(['active', 'completed']);
    expect(list[1]).toMatchObject({ goalId, accountHasOtherActive: true });
    await archiveGoal(nPribadi, { goalId: baru.goalId });
    await expect(restoreGoal(nPribadi, { goalId })).resolves.toMatchObject({ status: 'active' });
  });

  it('arsipkan lalu pulihkan: idempoten, kembali aktif', async () => {
    const { goalId } = await goalOf(nPribadi, tab);
    await archiveGoal(nPribadi, { goalId });
    await archiveGoal(nPribadi, { goalId });
    expect((await loadTujuan(nPribadi)).goals[0]).toMatchObject({ status: 'archived' });
    await restoreGoal(nPribadi, { goalId });
    expect((await loadTujuan(nPribadi)).goals[0]).toMatchObject({ status: 'active' });
  });

  it('membuat/mengubah tujuan tidak mengubah saldo dompet mana pun (I6)', async () => {
    const before = await listAccounts(nPribadi);
    const { goalId } = await goalOf(nPribadi, tab);
    await updateGoal(nPribadi, { goalId, name: 'Ubah', target: 7_000_000, targetOn: null });
    await archiveGoal(nPribadi, { goalId });
    const after = await listAccounts(nPribadi);
    expect(after.map((a) => [a.id, a.balance])).toEqual(before.map((a) => [a.id, a.balance]));
  });

  describe('isolasi dan Bersama (K1)', () => {
    it('[T11] tujuan Pribadi pasangan tidak terbaca dan tidak tertulis', async () => {
      const { goalId } = await goalOf(nPribadi, tab, { name: 'KANARI-N-PRIBADI' });
      expect((await loadTujuan(fPribadi)).goals).toEqual([]);
      expect((await loadTujuan(bersama)).goals).toEqual([]);
      const writes = [
        () => updateGoal(fPribadi, { goalId, name: 'X', target: 5, targetOn: null }),
        () => completeGoal(fPribadi, { goalId }),
        () => archiveGoal(fPribadi, { goalId }),
        () => restoreGoal(fPribadi, { goalId }),
        // Anggota kedua ruang tetapi rute Bersama: tujuan Pribadi sendiri tetap di luar ruangnya.
        () => archiveGoal(bersama, { goalId }),
        () => updateGoal(bersama, { goalId, name: 'X', target: 5, targetOn: null }),
      ];
      for (const w of writes) await expect(w()).rejects.toSatisfy((e) => codeOf(e) === 'not_found');
      // Dompet Pribadi tidak bisa dipakai membuat tujuan di Bersama, dan sebaliknya.
      await expect(goalOf(bersama, tab)).rejects.toSatisfy((e) => codeOf(e) === 'not_found');
      expect((await loadTujuan(nPribadi)).goals[0]).toMatchObject({
        status: 'active',
        name: 'KANARI-N-PRIBADI',
      });
    });

    it('Luar (bukan anggota) tidak bisa membaca atau menulis tujuan ruang mana pun', async () => {
      const tb = await wallet(bersama, 'Tabungan Bersama', 'tabungan');
      const { goalId } = await goalOf(bersama, tb);
      for (const c of [nPribadi, bersama]) {
        const forged = { ...c, userId: luar.id };
        await expect(loadTujuan(forged)).rejects.toSatisfy((e) => codeOf(e) === 'not_found');
        await expect(archiveGoal(forged, { goalId })).rejects.toSatisfy(
          (e) => codeOf(e) === 'not_found',
        );
      }
    });

    it('anggota kedua Bersama boleh membuat, mengubah, menyelesaikan, mengarsipkan, memulihkan; nama pembuat tampil', async () => {
      const tb = await wallet(bersama, 'Tabungan Bersama', 'tabungan', 3_000_000);
      const { goalId } = await goalOf(bersama, tb, { name: 'Liburan', target: 3_000_000 });
      const seenByF = await loadTujuan(fBersama);
      const { partnerName } = seenByF;
      let { goals } = seenByF;
      expect(partnerName).toBe('Novanda');
      expect(goals[0]).toMatchObject({ goalId, createdByName: 'Novanda', reached: true });
      expect((await loadTujuan(bersama)).partnerName).toBe('Farida');
      await updateGoal(fBersama, {
        goalId,
        name: 'Liburan 2027',
        target: 3_000_000,
        targetOn: null,
      });
      await completeGoal(fBersama, { goalId });
      await restoreGoal(fBersama, { goalId });
      await archiveGoal(fBersama, { goalId });
      const second = await wallet(bersama, 'Tabungan 2', 'tabungan');
      await goalOf(fBersama, second, { name: 'Dibuat Farida' });
      ({ goals } = await loadTujuan(bersama));
      expect(goals.find((g) => g.name === 'Dibuat Farida')?.createdByName).toBe('Farida');
    });

    it('[T11] setor lintas ruang (space_transfer) dari Pribadi Farida menaikkan progres tujuan Bersama', async () => {
      const tb = await wallet(bersama, 'Tabungan Bersama', 'tabungan');
      await goalOf(bersama, tb, { target: 4_000_000 });
      const fAcc = await wallet(fPribadi, 'BCA F', 'operasional', 5_000_000);
      await createSpaceTransfer(fPribadi, {
        clientId: randomUUID(),
        fromAccountId: fAcc,
        toSpaceId: bersama.spaceId,
        toAccountId: tb,
        amount: 1_000_000,
        fee: 0,
        allowNegative: false,
      });
      expect((await loadTujuan(fBersama)).goals[0]).toMatchObject({ balance: 1_000_000, pct: 25 });
      expect((await loadTujuan(bersama)).goals[0]).toMatchObject({ balance: 1_000_000, pct: 25 });
    });
  });
});
