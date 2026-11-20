import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAsset, revalueAsset } from '../aset';
import { toLedgerError } from '../errors';
import { loadKekayaan } from '../kekayaan';
import { resolveSpace } from '../space';
import { createAccount, createSpaceTransfer, createTransfer, type LedgerCtx } from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * S14 Task 9: kekayaan bersih lewat `loadKekayaan` (satu fungsi SQL, angka tidak dihitung di TS).
 * Tag `[T11]` = butir K13: (f) komponen dan total dari SQL, setoran lintas ruang menggeser per ruang
 * dengan jumlah tetap (B16), (h) kekayaan Pribadi pasangan tidak terbaca. Komponen saham, piutang,
 * utang, snapshot, dan hari kotor diuji pgTAP (`42_kekayaan.sql`) dan worker.
 */

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<LedgerCtx> {
  const { spaceId } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId };
}

const acc = async (
  ctx: LedgerCtx,
  name: string,
  pocket: 'operasional' | 'tabungan' | 'kantor',
  openingBalance: number,
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

describe('kekayaan bersih (S14 Task 9)', () => {
  let n: Persona;
  let f: Persona;
  let nPribadi: LedgerCtx;
  let bersama: LedgerCtx;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    if (!ps.f) throw new Error('persona kurang');
    n = ps.n;
    f = ps.f;
    nPribadi = await ctxOf(n, 'pribadi');
    bersama = await ctxOf(n, 'bersama');
  });

  it('[T11] komponen dari SQL: kas (operasional + tabungan), aset; Kantor tidak ikut; total = jumlah komponen', async () => {
    await acc(nPribadi, 'BCA', 'operasional', 3_000_000);
    await acc(nPribadi, 'Celengan', 'tabungan', 1_000_000);
    await acc(nPribadi, 'Kas Kantor', 'kantor', 9_000_000);
    const { accountId } = await createAsset(nPribadi, {
      clientId: randomUUID(),
      name: 'Emas',
      assetKind: 'emas',
      openingBalance: 2_000_000,
      openedOn: '2026-11-01',
    });
    await revalueAsset(nPribadi, { clientId: randomUUID(), accountId, value: 2_500_000 });
    const nw = await loadKekayaan(nPribadi);
    expect(nw).toMatchObject({
      kas: 4_000_000,
      aset: 2_500_000,
      sahamPasar: 0,
      sahamTanpaHarga: 0,
      piutang: 0,
      utang: 0,
      total: 6_500_000,
      priceAsOf: null,
      monthAgoTotal: null,
      monthAgoOn: null,
    });
  });

  it('pembanding 30 hari dari snapshot (tepat 30 hari lalu); tanpa snapshot null', async () => {
    await acc(nPribadi, 'BCA', 'operasional', 1_000_000);
    const { rows } = await h.admin.query<{ d: string }>(`select (app.today() - 30)::text as d`);
    const on = rows[0]?.d;
    await h.admin.query(
      `insert into app.net_worth_snapshots
         (space_id, on_date, kas, aset, saham_pasar, saham_tanpa_harga, piutang, utang, total, computed_at)
       values ($1, $2::date, 700000, 0, 0, 0, 0, 0, 700000, now())`,
      [nPribadi.spaceId, on],
    );
    const nw = await loadKekayaan(nPribadi);
    expect(nw.monthAgoTotal).toBe(700_000);
    expect(nw.monthAgoOn).toBe(on);
  });

  it('[T11] B16: setoran lintas ruang menggeser kekayaan per ruang, jumlah kedua ruang tetap', async () => {
    const bca = await acc(nPribadi, 'BCA', 'operasional', 2_000_000);
    const dapur = await acc(bersama, 'Dapur', 'operasional', 0);
    const sum = async () =>
      (await loadKekayaan(nPribadi)).total + (await loadKekayaan(bersama)).total;
    const before = await sum();
    await createSpaceTransfer(nPribadi, {
      clientId: randomUUID(),
      fromAccountId: bca,
      toSpaceId: bersama.spaceId,
      toAccountId: dapur,
      amount: 800_000,
      fee: 0,
      allowNegative: false,
    });
    expect((await loadKekayaan(nPribadi)).total).toBe(1_200_000);
    expect((await loadKekayaan(bersama)).total).toBe(800_000);
    expect(await sum()).toBe(before);
  });

  it('Bersama: piutang dan utang selalu 0; transfer dalam ruang tidak mengubah total', async () => {
    const a = await acc(bersama, 'Dapur', 'operasional', 500_000);
    const b = await acc(bersama, 'Tabungan', 'tabungan', 0);
    await createTransfer(bersama, {
      clientId: randomUUID(),
      fromAccountId: a,
      toAccountId: b,
      amount: 200_000,
    });
    expect(await loadKekayaan(bersama)).toMatchObject({
      kas: 500_000,
      piutang: 0,
      utang: 0,
      total: 500_000,
    });
  });

  it('[T11] kekayaan Pribadi pasangan tidak terbaca: F memakai ruang Pribadi N = tidak ada (DK404)', async () => {
    await acc(nPribadi, 'BCA', 'operasional', 1_000_000);
    const intruder: LedgerCtx = { pools: h.pools, userId: f.id, spaceId: nPribadi.spaceId };
    let err: unknown;
    try {
      await loadKekayaan(intruder);
    } catch (e) {
      err = e;
    }
    expect(toLedgerError(err)?.code).toBe('not_found');
    // Pribadi F sendiri kosong dan terpisah.
    expect((await loadKekayaan(await ctxOf(f, 'pribadi'))).total).toBe(0);
  });
});
