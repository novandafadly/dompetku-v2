import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAsset } from '../aset';
import { toLedgerError } from '../errors';
import { loadKekayaan } from '../kekayaan';
import { loadLaporan } from '../laporan';
import { listAccounts, monthSummary, safeToSpend } from '../read';
import {
  buyStock,
  loadStockOverview,
  openStockHolding,
  previewSell,
  restoreStockTrade,
  sellStock,
  setStockPrice,
  voidStockTrade,
} from '../saham';
import { resolveSpace } from '../space';
import { loadTrading } from '../trading';
import { archiveAccount, createAccount, createTransfer, type LedgerCtx } from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * S14 Task 10: saham lewat loader/wrapper server atas Postgres nyata (persona N pemilik, F anggota
 * Bersama). Tag `[T11]` = butir K13: (d) lembar, biaya rata-rata, untung/rugi terealisasi, jual >
 * lembar ditolak, batal trade terakhir membalik tepat sekali; (e) harga: lonjakan > 35% butuh
 * konfirmasi, nilai terakhir + tanggal dipakai; (h) harga/posisi Pribadi pasangan tidak terbaca
 * dan harga per ruang; I6: beli/jual/harga tidak mengubah pemasukan/pengeluaran, Laporan, aman dipakai.
 * Rumus SQL-nya diuji pgTAP (39–41); di sini hanya jalur server dan pemetaan galat.
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
  pocket: 'operasional' | 'trading',
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

const sahamAccount = async (ctx: LedgerCtx, name = 'Ajaib') =>
  (await createAsset(ctx, { clientId: randomUUID(), name, assetKind: 'saham' })).accountId;

const codeOf = (e: unknown) => toLedgerError(e)?.code;
const reject = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('seharusnya ditolak');
};
const month = () => new Date().toISOString().slice(0, 7);

describe('saham (S14 Task 10)', () => {
  let n: Persona;
  let f: Persona;
  let nPribadi: LedgerCtx;
  let fPribadi: LedgerCtx;
  let bersama: LedgerCtx;
  let bca: string;
  let ajaib: string;

  const buy = (over: Record<string, unknown> = {}) =>
    buyStock(nPribadi, {
      clientId: randomUUID(),
      accountId: ajaib,
      ticker: 'BBCA',
      shares: 200,
      price: 9150,
      fee: 1000,
      fromAccountId: bca,
      ...over,
    });
  const sell = (over: Record<string, unknown> = {}) =>
    sellStock(nPribadi, {
      clientId: randomUUID(),
      accountId: ajaib,
      ticker: 'BBCA',
      shares: 100,
      price: 9800,
      fee: 2000,
      tax: 1000,
      toAccountId: bca,
      ...over,
    });
  const overview = async (ctx = nPribadi, account = ajaib) => loadStockOverview(ctx, account);
  const bbca = async () => (await overview()).holdings.find((x) => x.ticker === 'BBCA');
  const balanceOf = async (id: string) =>
    (await listAccounts(nPribadi)).find((a) => a.id === id)?.balance;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    if (!ps.f) throw new Error('persona kurang');
    n = ps.n;
    f = ps.f;
    nPribadi = await ctxOf(n, 'pribadi');
    fPribadi = await ctxOf(f, 'pribadi');
    bersama = await ctxOf(n, 'bersama');
    bca = await wallet(nPribadi, 'BCA', 'operasional', 20_000_000);
    ajaib = await sahamAccount(nPribadi);
  });

  it('[T11] posisi: dua beli beda harga = biaya rata-rata (floor), jual sebagian dan habis = untung/rugi terealisasi', async () => {
    const b1 = await buy(); // 200 x 9.150 + biaya 1.000 = 1.831.000
    expect(b1.amount).toBe(1_831_000);
    await buy({ shares: 100, price: 9300, fee: 0 }); // + 930.000 = 2.761.000 untuk 300 lembar
    let p = await bbca();
    expect(p).toMatchObject({ shares: 300, costTotal: 2_761_000, avgCost: 9203, realized: 0 });
    expect(p?.trades.map((t) => [t.side, t.shares])).toEqual([
      ['buy', 100],
      ['buy', 200],
    ]);
    expect(p?.trades.map((t) => t.counterName)).toEqual(['BCA', 'BCA']); // sumber beli, untuk dialog batal
    expect(await balanceOf(ajaib)).toBe(2_761_000); // saldo buku = Σ biaya posisi
    expect(await balanceOf(bca)).toBe(20_000_000 - 2_761_000);

    // Pratinjau = hasil jual (satu rumus di SQL; UI tidak menghitung).
    const pv = await previewSell(nPribadi, {
      accountId: ajaib,
      ticker: 'BBCA',
      shares: 100,
      price: 9800,
      fee: 2000,
      tax: 1000,
    });
    expect(pv).toEqual({ costRemoved: 920_333, proceeds: 977_000, realized: 56_667 });
    const s1 = await sell();
    expect(s1).toMatchObject({ proceeds: 977_000, realized: 56_667 });
    p = await bbca();
    expect(p).toMatchObject({ shares: 200, costTotal: 1_840_667, realized: 56_667 });
    // Jual habis = seluruh sisa biaya keluar (tanpa sisa pembulatan).
    const s2 = await sell({ shares: 200, price: 9000, fee: 0, tax: 0 });
    expect(s2.realized).toBe(-40_667);
    p = await bbca();
    expect(p).toMatchObject({ shares: 0, costTotal: 0, realized: 16_000 });
    expect(await balanceOf(ajaib)).toBe(0);
    expect((await overview()).total).toMatchObject({ realized: 16_000, costTotal: 0 });
  });

  it('[T11] jual melebihi lembar = insufficient_shares (pratinjau dan simpan); kode tak dipegang = not_found', async () => {
    await buy();
    expect(codeOf(await reject(sell({ shares: 201 })))).toBe('insufficient_shares');
    expect(
      codeOf(
        await reject(
          previewSell(nPribadi, { accountId: ajaib, ticker: 'BBCA', shares: 201, price: 9800 }),
        ),
      ),
    ).toBe('insufficient_shares');
    expect(codeOf(await reject(sell({ ticker: 'TLKM' })))).toBe('not_found');
    expect((await bbca())?.shares).toBe(200);
  });

  it('[T11] batal/pulihkan hanya trade terakhir, tepat sekali; selain itu trade_not_latest', async () => {
    const first = await buy();
    const second = await buy({ shares: 100, price: 9300, fee: 0 });
    expect(
      codeOf(
        await reject(voidStockTrade(nPribadi, { clientId: randomUUID(), tradeId: first.tradeId })),
      ),
    ).toBe('trade_not_latest');
    const v = randomUUID();
    await voidStockTrade(nPribadi, { clientId: v, tradeId: second.tradeId });
    // Klik ganda = permintaan sama: tidak membatalkan dua kali.
    await voidStockTrade(nPribadi, { clientId: v, tradeId: second.tradeId });
    expect(await bbca()).toMatchObject({ shares: 200, costTotal: 1_831_000 });
    expect(await balanceOf(bca)).toBe(20_000_000 - 1_831_000);
    await restoreStockTrade(nPribadi, { clientId: randomUUID(), tradeId: second.tradeId });
    expect(await bbca()).toMatchObject({ shares: 300, costTotal: 2_761_000 });
    // Batal jual membalik untung/rugi dan lembar.
    const s = await sell();
    expect((await bbca())?.realized).toBe(56_667);
    await voidStockTrade(nPribadi, { clientId: randomUUID(), tradeId: s.tradeId });
    expect(await bbca()).toMatchObject({ shares: 300, realized: 0 });
    expect((await bbca())?.lastTradeId).toBe(second.tradeId);
  });

  it('[P2] jual semua: kode berlembar 0 tetap memuat transaksi terakhir; dibatalkan = kode aktif lagi', async () => {
    await buy({ shares: 200 });
    const s = await sell({ shares: 200, fee: 0, tax: 0 });
    const gone = await bbca();
    expect(gone).toMatchObject({ shares: 0, lastTradeId: s.tradeId });
    expect(gone?.trades[0]).toMatchObject({ id: s.tradeId, side: 'sell', shares: 200 });
    await voidStockTrade(nPribadi, { clientId: randomUUID(), tradeId: s.tradeId });
    expect(await bbca()).toMatchObject({ shares: 200, costTotal: 1_831_000, realized: 0 });
  });

  it('beli idempoten: clientId sama = satu transaksi', async () => {
    const clientId = randomUUID();
    const a = await buy({ clientId });
    const b = await buy({ clientId });
    expect(b.tradeId).toBe(a.tradeId);
    expect((await bbca())?.shares).toBe(200);
    expect(await balanceOf(bca)).toBe(20_000_000 - 1_831_000);
  });

  it('saldo dompet sumber kurang = saldo_negatif; dengan allowNegative lanjut', async () => {
    const kecil = await wallet(nPribadi, 'Dana', 'operasional', 500_000);
    expect(codeOf(await reject(buy({ fromAccountId: kecil })))).toBe('saldo_negatif');
    expect(await bbca()).toBeUndefined();
    await buy({ fromAccountId: kecil, allowNegative: true });
    expect(await balanceOf(kecil)).toBe(500_000 - 1_831_000);
  });

  it('[T11] saham yang sudah dimiliki: tanpa efek kas, masuk kekayaan bersih; tanggal sebelum dompet dibuat ditolak', async () => {
    const before = await loadKekayaan(nPribadi);
    await openStockHolding(nPribadi, {
      clientId: randomUUID(),
      accountId: ajaib,
      ticker: 'TLKM',
      shares: 250,
      price: 3000,
    });
    expect(await balanceOf(bca)).toBe(20_000_000);
    const p = (await overview()).holdings.find((x) => x.ticker === 'TLKM');
    expect(p).toMatchObject({ shares: 250, costTotal: 750_000, avgCost: 3000 });
    const nw = await loadKekayaan(nPribadi);
    expect(nw.total).toBe(before.total + 750_000);
    expect(nw.sahamTanpaHarga).toBe(1);
    const e = await reject(
      openStockHolding(nPribadi, {
        clientId: randomUUID(),
        accountId: ajaib,
        ticker: 'ASII',
        shares: 100,
        price: 5000,
        on: '2020-01-01',
      }),
    );
    expect(codeOf(e)).toBe('before_opening');
  });

  it('[T11] harga: nilai pasar = lembar x harga ok terakhir + tanggal; tanpa harga = biaya beli', async () => {
    await buy({ fee: 0, shares: 100, price: 9000 }); // biaya 900.000
    expect(await bbca()).toMatchObject({ close: null, marketValue: 900_000, unrealized: null });
    expect((await overview()).total.missingPriceCount).toBe(1);
    await setStockPrice(nPribadi, { clientId: randomUUID(), ticker: 'BBCA', close: 9500 });
    const p = await bbca();
    expect(p).toMatchObject({
      close: 9500,
      marketValue: 950_000,
      unrealized: 50_000,
      heldPending: false,
      stale: false,
    });
    expect(p?.closeOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await overview()).total).toMatchObject({ marketValue: 950_000, unrealized: 50_000 });
    expect((await loadKekayaan(nPribadi)).sahamPasar).toBe(950_000);
  });

  it('[T11] lonjakan harga > 35% butuh konfirmasi; ditolak tidak mengubah nilai; dikonfirmasi dipakai', async () => {
    await buy({ fee: 0, shares: 100, price: 9000 });
    await setStockPrice(nPribadi, {
      clientId: randomUUID(),
      ticker: 'BBCA',
      close: 9000,
      on: '2026-11-10',
    });
    const spike = { ticker: 'BBCA', close: 15_000, on: '2026-11-12' };
    expect(
      codeOf(await reject(setStockPrice(nPribadi, { clientId: randomUUID(), ...spike }))),
    ).toBe('price_spike_unconfirmed');
    expect((await bbca())?.close).toBe(9000);
    await setStockPrice(nPribadi, { clientId: randomUUID(), ...spike, confirmSpike: true });
    expect((await bbca())?.close).toBe(15_000);
    // Harga tidak sah (di luar 1..10^9) ditolak di batas Zod sebelum DB.
    expect(
      await reject(setStockPrice(nPribadi, { clientId: randomUUID(), ticker: 'BBCA', close: 0 })),
    ).toBeInstanceOf(Error);
  });

  it('[T11] harga per ruang: harga Pribadi N tidak terbaca F; F mengisi kode sama tanpa mengubah N', async () => {
    await buy({ fee: 0, shares: 100, price: 9000 });
    await setStockPrice(nPribadi, { clientId: randomUUID(), ticker: 'BBCA', close: 9400 });
    // F tidak melihat dompet saham N (RLS) dan tidak bisa menulis lewat ruangnya.
    expect(codeOf(await reject(loadStockOverview(fPribadi, ajaib)))).toBe('not_found');
    expect(
      codeOf(
        await reject(
          buyStock(fPribadi, {
            clientId: randomUUID(),
            accountId: ajaib,
            ticker: 'BBCA',
            shares: 100,
            price: 9000,
            fromAccountId: bca,
          }),
        ),
      ),
    ).toBe('not_found');
    await setStockPrice(fPribadi, { clientId: randomUUID(), ticker: 'BBCA', close: 5000 });
    expect((await bbca())?.close).toBe(9400);
    // Pribadi pasangan tidak punya posisi lewat id dompet N di ruang Bersama.
    expect(codeOf(await reject(loadStockOverview(bersama, ajaib)))).toBe('not_found');
    // Bersama tidak menerima harga saham (hanya Pribadi).
    expect(
      codeOf(
        await reject(
          setStockPrice(bersama, { clientId: randomUUID(), ticker: 'BBCA', close: 100 }),
        ),
      ),
    ).toBe('pocket_personal_only');
    // Trade N tidak bisa dibatalkan F.
    const t = (await bbca())?.lastTradeId;
    if (t === null || t === undefined) throw new Error('tanpa trade');
    expect(
      codeOf(await reject(voidStockTrade(fPribadi, { clientId: randomUUID(), tradeId: t }))),
    ).toBe('not_found');
  });

  it('[I6] beli, jual, dan harga tidak mengubah pemasukan/pengeluaran, Laporan, dan aman dipakai', async () => {
    const trading = await wallet(nPribadi, 'RDN', 'trading', 0);
    await createTransfer(nPribadi, {
      clientId: randomUUID(),
      fromAccountId: bca,
      toAccountId: trading,
      amount: 5_000_000,
    });
    const snap = async () => ({
      bulan: await monthSummary(nPribadi, month()),
      aman: (await safeToSpend(nPribadi)).operasional,
      laporan: (await loadLaporan({ ...nPribadi, kind: 'personal' })).summary,
    });
    const before = await snap();
    await buy({ fromAccountId: trading });
    await setStockPrice(nPribadi, { clientId: randomUUID(), ticker: 'BBCA', close: 11_000 });
    await sell({ toAccountId: trading });
    await openStockHolding(nPribadi, {
      clientId: randomUUID(),
      accountId: ajaib,
      ticker: 'TLKM',
      shares: 100,
      price: 3000,
    });
    const after = await snap();
    expect(after.bulan.pemasukan).toBe(before.bulan.pemasukan);
    expect(after.bulan.pengeluaran).toBe(before.bulan.pengeluaran);
    expect(after.aman).toBe(before.aman);
    expect(after.laporan).toEqual(before.laporan);
  });

  it('[T11] modal trading: beli dari dompet trading bukan tarik modal; Kurang total memasukkan biaya beli saham', async () => {
    const trading = await wallet(nPribadi, 'RDN', 'trading', 0);
    await createTransfer(nPribadi, {
      clientId: randomUUID(),
      fromAccountId: bca,
      toAccountId: trading,
      amount: 5_000_000,
    });
    let t = await loadTrading(nPribadi);
    expect(t.total).toMatchObject({ capitalLeft: 5_000_000, shortfall: 0, stockCost: 0 });
    await buy({ fromAccountId: trading }); // 1.831.000 pindah ke dompet saham
    t = await loadTrading(nPribadi);
    expect(t.total).toMatchObject({
      capitalIn: 5_000_000,
      capitalOut: 0,
      capitalLeft: 5_000_000,
      balance: 3_169_000,
      stockCost: 1_831_000,
      shortfall: 0, // 5.000.000 - 3.169.000 - 1.831.000
    });
    // Per dompet tanpa Kurang dan tanpa biaya saham (S12S13-C9).
    expect(t.accounts[0]?.stockCost).toBeUndefined();
  });

  it('arsip dompet saham berlembar ditolak (account_has_holdings); sesudah jual habis boleh', async () => {
    await buy({ shares: 100, price: 9000, fee: 0 });
    expect(codeOf(await reject(archiveAccount(nPribadi, ajaib)))).toBe('account_has_holdings');
    await sell({ shares: 100, price: 9000, fee: 0, tax: 0 });
    await expect(archiveAccount(nPribadi, ajaib)).resolves.toMatchObject({ archived: true });
  });

  it('saham di Bersama ditolak; dompet saham Pribadi tidak bisa dipakai lewat ruang Bersama', async () => {
    expect(
      codeOf(
        await reject(
          createAsset(bersama, { clientId: randomUUID(), name: 'Ajaib', assetKind: 'saham' }),
        ),
      ),
    ).toBe('pocket_personal_only');
    expect(
      codeOf(
        await reject(
          buyStock(bersama, {
            clientId: randomUUID(),
            accountId: ajaib,
            ticker: 'BBCA',
            shares: 100,
            price: 9000,
            fromAccountId: bca,
          }),
        ),
      ),
    ).toBe('not_found');
  });
});
