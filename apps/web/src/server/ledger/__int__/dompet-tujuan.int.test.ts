import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { toLedgerError } from '../errors';
import { loadDompetDaftar, loadDompetRiwayat } from '../dompet';
import { listAccounts } from '../read';
import { resolveSpace } from '../space';
import { archiveGoal, completeGoal, createGoal, loadGoalForAccount, loadTujuan } from '../tujuan';
import {
  archiveAccount,
  createAccount,
  createSpaceTransfer,
  createTransfer,
  type LedgerCtx,
} from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * S13 Task 5: Detail dompet dan daftar Dompet dengan tujuan (loader `goal_for_account`, teks tujuan
 * satu kueri, arsip dompet bertujuan ditolak `account_has_goal`). Tujuan tidak mengubah saldo,
 * kekayaan bersih, atau riwayat dompet (K2/I6). SQL-nya diuji pgTAP (35/36).
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
  pocket: 'operasional' | 'tabungan',
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

const archiveCode = async (ctx: LedgerCtx, accountId: string) => {
  try {
    await archiveAccount(ctx, accountId);
    return 'ok';
  } catch (e) {
    return toLedgerError(e)?.code;
  }
};

const netWorth = async (ctx: LedgerCtx) =>
  (await listAccounts(ctx))
    .filter((a) => a.pocket !== 'kantor' && a.pocket !== 'patungan')
    .reduce((s, a) => s + a.balance, 0);

describe('Dompet dan tujuan (S13 Task 5)', () => {
  let n: Persona;
  let f: Persona;
  let nPribadi: LedgerCtx;
  let fPribadi: LedgerCtx;
  let bersama: LedgerCtx;
  let fBersama: LedgerCtx;
  let bca: string;
  let tab: string;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    if (!ps.f) throw new Error('persona kurang');
    n = ps.n;
    f = ps.f;
    nPribadi = await ctxOf(n, 'pribadi');
    fPribadi = await ctxOf(f, 'pribadi');
    bersama = await ctxOf(n, 'bersama');
    fBersama = await ctxOf(f, 'bersama');
    bca = await wallet(nPribadi, 'BCA', 'operasional', 20_000_000);
    tab = await wallet(nPribadi, 'Tabungan BCA', 'tabungan', 1_000_000);
  });

  it('goal_for_account: tujuan aktif dompet tabungan dengan progres SQL; tanpa tujuan = null', async () => {
    expect(await loadGoalForAccount(nPribadi, tab)).toEqual({ goal: null, partnerName: null });
    const { goalId } = await goalOf(nPribadi, tab);
    const { goal, partnerName } = await loadGoalForAccount(nPribadi, tab);
    expect(partnerName).toBeNull();
    expect(goal).toMatchObject({
      goalId,
      accountId: tab,
      accountName: 'Tabungan BCA',
      status: 'active',
      saved: 1_000_000,
      pct: 10,
      reached: false,
      createdByName: null,
    });
  });

  it('tujuan selesai/diarsip tidak muncul di Detail dompet; dompet bisa dipakai tujuan baru', async () => {
    const { goalId } = await goalOf(nPribadi, tab);
    await archiveGoal(nPribadi, { goalId });
    expect((await loadGoalForAccount(nPribadi, tab)).goal).toBeNull();
    await goalOf(nPribadi, tab, { name: 'Baru' });
    expect((await loadGoalForAccount(nPribadi, tab)).goal?.name).toBe('Baru');
  });

  it('Bersama dua anggota: nama pembuat dan anggota lain; dompet ruang lain = tidak terbaca', async () => {
    const bt = await wallet(bersama, 'Tabungan Bersama', 'tabungan', 0);
    await goalOf(bersama, bt, { name: 'Liburan' });
    const mine = await loadGoalForAccount(fBersama, bt);
    expect(mine.partnerName).toBe(n.name);
    expect(mine.goal).toMatchObject({ name: 'Liburan', createdByName: n.name });
    // Dompet Bersama dibuka lewat konteks Pribadi pasangan: ditolak seragam (bukan ruang ini).
    await expect(loadGoalForAccount(fPribadi, bt)).rejects.toThrow();
    await expect(loadGoalForAccount(nPribadi, randomUUID())).rejects.toThrow();
  });

  it('daftar Dompet: satu kueri teks tujuan hanya tujuan aktif per dompet; withGoals=false = kosong', async () => {
    expect((await loadDompetDaftar(nPribadi, 'personal', true)).goalLines).toEqual({});
    const { goalId } = await goalOf(nPribadi, tab, { name: 'Dana darurat', target: 4_000_000 });
    const lines = (await loadDompetDaftar(nPribadi, 'personal', true)).goalLines;
    expect(lines).toEqual({ [tab]: { name: 'Dana darurat', pct: 25, reached: false } });
    expect((await loadDompetDaftar(nPribadi, 'personal')).goalLines).toEqual({});
    await archiveGoal(nPribadi, { goalId });
    expect((await loadDompetDaftar(nPribadi, 'personal', true)).goalLines).toEqual({});
    // Tujuan Bersama tidak bocor ke daftar Pribadi.
    const bt = await wallet(bersama, 'Tabungan Bersama', 'tabungan', 0);
    await goalOf(bersama, bt, { name: 'Liburan' });
    expect((await loadDompetDaftar(nPribadi, 'personal', true)).goalLines).toEqual({});
    expect(Object.keys((await loadDompetDaftar(fBersama, 'shared', true)).goalLines)).toEqual([bt]);
  });

  it('tercapai: reached dari SQL di teks daftar', async () => {
    await goalOf(nPribadi, tab, { target: 1_000_000 });
    const line = (await loadDompetDaftar(nPribadi, 'personal', true)).goalLines[tab];
    expect(line).toEqual({ name: 'Dana darurat', pct: 100, reached: true });
  });

  it('[T11] arsip dompet bertujuan aktif ditolak account_has_goal (saldo 0 maupun tidak); berhasil sesudah tujuan diselesaikan/diarsipkan', async () => {
    const kosong = await wallet(nPribadi, 'Tabungan Kosong', 'tabungan', 0);
    const gKosong = await goalOf(nPribadi, kosong, { target: 1_000_000 });
    expect(await archiveCode(nPribadi, kosong)).toBe('account_has_goal');
    // Saldo ≠ 0 + tujuan aktif: tujuan ditolak lebih dulu (K6), bukan balance_not_zero.
    const gTab = await goalOf(nPribadi, tab);
    expect(await archiveCode(nPribadi, tab)).toBe('account_has_goal');
    await archiveGoal(nPribadi, gKosong);
    expect(await archiveCode(nPribadi, kosong)).toBe('ok');
    // Tujuan tercapai lalu diselesaikan membebaskan dompet; saldo tetap menahan arsip.
    await createTransfer(nPribadi, {
      clientId: randomUUID(),
      fromAccountId: bca,
      toAccountId: tab,
      amount: 9_000_000,
    });
    await completeGoal(nPribadi, gTab);
    expect(await archiveCode(nPribadi, tab)).toBe('balance_not_zero');
  });

  it('[T11] tujuan tidak mengubah saldo, kekayaan bersih, atau riwayat dompet', async () => {
    const before = {
      worth: await netWorth(nPribadi),
      accounts: await listAccounts(nPribadi),
      history: await loadDompetRiwayat(nPribadi, tab, 50, await listAccounts(nPribadi)),
    };
    const { goalId } = await goalOf(nPribadi, tab);
    const during = {
      worth: await netWorth(nPribadi),
      accounts: await listAccounts(nPribadi),
      history: await loadDompetRiwayat(nPribadi, tab, 50, await listAccounts(nPribadi)),
    };
    expect(during).toEqual(before);
    await archiveGoal(nPribadi, { goalId });
    expect(await netWorth(nPribadi)).toBe(before.worth);
    expect(await listAccounts(nPribadi)).toEqual(before.accounts);
  });

  it('setor lintas ruang menggeser teks tujuan Bersama; Pribadi pasangan tidak ikut', async () => {
    const bt = await wallet(bersama, 'Tabungan Bersama', 'tabungan', 0);
    await goalOf(bersama, bt, { name: 'Liburan', target: 1_000_000 });
    const fKas = await wallet(fPribadi, 'Kas F', 'operasional', 5_000_000);
    await createSpaceTransfer(fPribadi, {
      clientId: randomUUID(),
      fromAccountId: fKas,
      toSpaceId: bersama.spaceId,
      toAccountId: bt,
      amount: 250_000,
      fee: 0,
      allowNegative: false,
    });
    expect((await loadDompetDaftar(nPribadi, 'personal', true)).goalLines).toEqual({});
    expect((await loadDompetDaftar(bersama, 'shared', true)).goalLines[bt]).toEqual({
      name: 'Liburan',
      pct: 25,
      reached: false,
    });
    expect((await loadTujuan(bersama)).goals[0]).toMatchObject({ pct: 25, saved: 250_000 });
  });
});
