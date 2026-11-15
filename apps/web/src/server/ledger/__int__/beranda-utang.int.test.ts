import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadBeranda } from '../beranda';
import { resolveSpace } from '../space';
import { createDebt, payDebt, voidDebt } from '../utang';
import { createAccount, type LedgerCtx } from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * S12 Task 3 (K1): kartu `Utang yang harus dibayar` dari `api.debt_totals` lewat `loadBeranda`.
 * Angka dari SQL, hanya Pribadi, utang terhapus/lunas tidak dihitung, "aman dipakai" tetap kas murni.
 */

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

type Ctx = LedgerCtx & { kind: 'personal' | 'shared' };

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<Ctx> {
  const { spaceId, kind } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId, kind };
}

describe('loadBeranda: kartu utang (S12-UT1)', () => {
  let n: Persona;
  let f: Persona;
  let pribadi: Ctx;
  let bca: string;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    n = ps.n;
    if (!ps.f) throw new Error('Farida tidak ada');
    f = ps.f;
    pribadi = await ctxOf(n, 'pribadi');
    bca = (
      await createAccount(pribadi, {
        clientId: randomUUID(),
        name: 'BCA',
        pocket: 'operasional',
        walletType: 'bank',
        openingBalance: 1_000_000,
      })
    ).accountId;
  });

  const debt = (direction: 'borrowed' | 'lent', principal: number, name: string, baru = true) =>
    createDebt(pribadi, {
      clientId: randomUUID(),
      direction,
      principal,
      mode: baru ? 'baru' : 'berjalan',
      contactName: name,
      ...(baru ? { accountId: bca } : {}),
    });

  it('tanpa utang: debts null', async () => {
    expect((await loadBeranda(pribadi)).debts).toBeNull();
  });

  it('Σ sisa per arah dari SQL, utang berjalan ikut, cicilan mengurangi; aman dipakai tetap kas murni', async () => {
    const dipinjam = await debt('borrowed', 2_000_000, 'Budi');
    await debt('borrowed', 900_000, 'Ibu', false);
    const dipiutang = await debt('lent', 750_000, 'Sari');
    await payDebt(pribadi, {
      clientId: randomUUID(),
      debtId: dipinjam.debtId,
      accountId: bca,
      amount: 300_000,
    });
    await payDebt(pribadi, {
      clientId: randomUUID(),
      debtId: dipiutang.debtId,
      accountId: bca,
      amount: 250_000,
    });
    const b = await loadBeranda(pribadi);
    expect(b.debts).toEqual({ borrowed: 1_700_000 + 900_000, lent: 500_000, activeCount: 3 });
    // Kas: 1.000.000 + 2.000.000 − 300.000 − 750.000 + 250.000; utang tidak mengurangi aman.
    expect(b.safe.operasional).toBe(2_200_000);
    expect(b.safe.aman).toBe(2_200_000);
  });

  it('utang lunas dan utang dihapus tidak dihitung; semua nol = null', async () => {
    const a = await debt('borrowed', 100_000, 'A');
    const c = await debt('lent', 200_000, 'C');
    await payDebt(pribadi, {
      clientId: randomUUID(),
      debtId: a.debtId,
      accountId: bca,
      amount: 100_000,
    });
    expect((await loadBeranda(pribadi)).debts).toEqual({
      borrowed: 0,
      lent: 200_000,
      activeCount: 1,
    });
    await voidDebt(pribadi, { clientId: randomUUID(), debtId: c.debtId });
    expect((await loadBeranda(pribadi)).debts).toBeNull();
  });

  it('Bersama: debts null; Pribadi Farida tidak melihat utang Novanda', async () => {
    await debt('borrowed', 500_000, 'Budi');
    expect((await loadBeranda(await ctxOf(n, 'bersama'))).debts).toBeNull();
    expect((await loadBeranda(await ctxOf(f, 'pribadi'))).debts).toBeNull();
    expect((await loadBeranda(pribadi)).debts).toMatchObject({ borrowed: 500_000 });
  });
});
