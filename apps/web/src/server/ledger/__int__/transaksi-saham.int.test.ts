import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { detailAbilities } from '@/app/[ruang]/_real/detail';
import { entryKindLabelVM, entryTitleVM } from '@/features/ledger/present';
import { createAsset, revalueAsset } from '../aset';
import { loadDetail } from '../detail';
import { exportLaporanCsv } from '../ekspor';
import { toLedgerError } from '../errors';
import { loadLaporan } from '../laporan';
import { loadSampah } from '../sampah';
import { buyStock, openStockHolding, restoreStockTrade, sellStock, voidStockTrade } from '../saham';
import { resolveSpace } from '../space';
import { loadTransaksi } from '../transaksi';
import { createAccount, createEntry, restoreEntry, voidEntry, type LedgerCtx } from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * S14 Task 11: Transaksi, Laporan, Ekspor, dan Sampah mengenal perubahan nilai aset dan trade saham
 * (Postgres nyata). Tag `[T11]`/`[I6]`: Σ pemasukan/pengeluaran CSV = Laporan walau ada aset dan
 * saham, kelas x_valuasi hanya di "Tidak termasuk", entri trade tidak punya aksi generik, Sampah
 * memulihkan trade lewat jalurnya (satu baris per trade) dan `trade_not_latest` terpetakan.
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

async function expenseCategory(ctx: LedgerCtx): Promise<string> {
  const { rows } = await h.admin.query<{ id: string }>(
    `select id from app.categories
      where space_id = $1 and type = 'expense' and parent_id is null order by sort_order limit 1`,
    [ctx.spaceId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('kategori pengeluaran tidak ada');
  return id;
}

const codeOf = (e: unknown) => toLedgerError(e)?.code;
const reject = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('seharusnya ditolak');
};

describe('S14 Task 11: Transaksi, Laporan, Ekspor, Sampah untuk aset dan saham', () => {
  let n: Persona;
  let pribadi: Ctx;
  let bersama: Ctx;
  let bca: string;
  let ajaib: string;
  let emas: string;
  let beli: string;
  let jual: string;
  let sebelum: { pemasukan: number; pengeluaran: number };

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    n = ps.n;
    pribadi = await ctxOf(n, 'pribadi');
    bersama = await ctxOf(n, 'bersama');
    bca = (
      await createAccount(pribadi, {
        clientId: randomUUID(),
        name: 'BCA',
        pocket: 'operasional',
        walletType: 'bank',
        openingBalance: 20_000_000,
      })
    ).accountId;
    ajaib = (
      await createAsset(pribadi, { clientId: randomUUID(), name: 'Ajaib', assetKind: 'saham' })
    ).accountId;
    emas = (await createAsset(pribadi, { clientId: randomUUID(), name: 'Emas', assetKind: 'emas' }))
      .accountId;
    await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: bca,
      kind: 'expense',
      amount: 45_000,
      categoryId: await expenseCategory(pribadi),
      description: 'Belanja',
    });
    sebelum = {
      pemasukan: (await loadLaporan(pribadi, { basis: 'kalender' })).summary.pemasukan,
      pengeluaran: (await loadLaporan(pribadi, { basis: 'kalender' })).summary.pengeluaran,
    };
    beli = (
      await buyStock(pribadi, {
        clientId: randomUUID(),
        accountId: ajaib,
        ticker: 'BBCA',
        shares: 200,
        price: 9150,
        fee: 0,
        fromAccountId: bca,
      })
    ).tradeId;
    jual = (
      await sellStock(pribadi, {
        clientId: randomUUID(),
        accountId: ajaib,
        ticker: 'BBCA',
        shares: 100,
        price: 9800,
        fee: 0,
        tax: 0,
        toAccountId: bca,
      })
    ).tradeId;
    await openStockHolding(pribadi, {
      clientId: randomUUID(),
      accountId: ajaib,
      ticker: 'TLKM',
      shares: 300,
      price: 1500,
    });
    await revalueAsset(pribadi, { clientId: randomUUID(), accountId: emas, value: 5_000_000 });
  });

  it('[T11] Transaksi: baris trade membawa tautan trade dan label Beli/Jual/Untung jual; valuasi menyebut aset', async () => {
    const t = await loadTransaksi(pribadi, new Date().toISOString().slice(0, 7));
    const labels = t.entries.map((e) => `${entryTitleVM(e)} | ${entryKindLabelVM(e)}`);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Beli BBCA · 200 lembar | Beli saham',
        'Jual BBCA · 100 lembar | Jual saham',
        'Untung jual BBCA | Jual saham',
        'TLKM · 300 lembar | Saham yang sudah dimiliki',
        'Perubahan nilai · Emas | Perubahan nilai',
      ]),
    );
    const tradeRows = t.entries.filter((e) => e.trade !== undefined);
    // beli (1) + jual (transfer + valuasi) + saham berjalan (1)
    expect(tradeRows).toHaveLength(4);
    expect(
      tradeRows.every((e) => e.trade?.accountId === ajaib && e.trade.accountName === 'Ajaib'),
    ).toBe(true);
    expect(
      t.entries.find((e) => e.kind === 'valuation' && e.trade === undefined)?.accountName,
    ).toBe('Emas');
  });

  it('[T11] entri trade tidak punya aksi generik: DB menolak Batalkan, Detail tanpa Ubah/Batalkan', async () => {
    const t = await loadTransaksi(pribadi, new Date().toISOString().slice(0, 7));
    const leg = t.entries.find((e) => e.trade?.id === beli);
    if (!leg) throw new Error('entri beli tidak ada');
    expect(
      codeOf(
        await reject(
          voidEntry(pribadi, {
            clientId: randomUUID(),
            entryId: leg.id,
            expectedVersion: leg.version,
          }),
        ),
      ),
    ).toBe('stock_account_trade_only');
    const d = await loadDetail(pribadi, leg.id);
    if (!d) throw new Error('detail tidak ada');
    expect(detailAbilities(d.entry, d, '2026-01-01', n.id)).toEqual({
      editable: false,
      voidable: false,
      movable: false,
      reimbursable: null,
    });
    expect(d.entry.trade?.id).toBe(beli);
  });

  it('[T11][I6] Ekspor: Σ pemasukan/pengeluaran = Laporan, x_valuasi hanya di Tidak termasuk, Catatan trade', async () => {
    const ex = await exportLaporanCsv(pribadi, { basis: 'kalender' });
    const lp = await loadLaporan(pribadi, { basis: 'kalender' });
    const sum = (f: (r: (typeof ex.rows)[number]) => boolean) =>
      ex.rows.filter(f).reduce((a, r) => a + r.amount, 0);
    expect(sum((r) => r.reportClass === 'income')).toBe(lp.summary.pemasukan);
    expect(-sum((r) => r.reportClass === 'expense' || r.reportClass === 'expense_fee')).toBe(
      lp.summary.pengeluaran,
    );
    // Aset dan saham tidak menggeser Pemasukan/Pengeluaran.
    expect(lp.summary.pemasukan).toBe(sebelum.pemasukan);
    expect(lp.summary.pengeluaran).toBe(sebelum.pengeluaran);

    const xval = (dir: 'in' | 'out') =>
      lp.classes.find((c) => c.reportClass === 'x_valuasi' && c.direction === dir)?.amount ?? 0;
    expect(sum((r) => r.reportClass === 'x_valuasi' && r.amount > 0)).toBe(xval('in'));
    expect(0 - sum((r) => r.reportClass === 'x_valuasi' && r.amount < 0)).toBe(xval('out'));
    expect(xval('in')).toBe(5_000_000 + 65_000);
    expect(
      ex.rows.filter((r) => r.kind === 'valuation').every((r) => r.reportClass === 'x_valuasi'),
    ).toBe(true);

    const notes = ex.rows.map((r) => r.note);
    expect(notes).toEqual(
      expect.arrayContaining([
        'Beli BBCA 200 lembar @ 9.150',
        'Jual BBCA 100 lembar @ 9.800',
        'Untung jual BBCA 100 lembar @ 9.800',
        'TLKM 300 lembar @ 1.500 (sudah dimiliki)',
        'Perubahan nilai',
      ]),
    );
    expect(ex.csv).toContain('Beli BBCA 200 lembar @ 9.150');
  });

  it('[T11] Ekspor Bersama tidak memuat trade atau aset Pribadi', async () => {
    const ex = await exportLaporanCsv(bersama, { basis: 'kalender' });
    expect(ex.csv).not.toMatch(/BBCA|TLKM|lembar|Ajaib|Emas|valuation|x_valuasi/);
  });

  it('[T11] Sampah: trade batal = satu baris per trade; Pulihkan lewat restoreStockTrade; generik ditolak', async () => {
    await voidStockTrade(pribadi, { clientId: randomUUID(), tradeId: jual });
    let s = await loadSampah(pribadi);
    // jual punya dua entri (transfer + valuasi), tampil satu baris dengan tautan trade
    expect(s.items).toHaveLength(1);
    const row = s.items[0]?.entry;
    expect(row?.trade).toMatchObject({ id: jual, ticker: 'BBCA', side: 'sell', shares: 100 });
    expect(row?.kind).toBe('transfer');
    if (!row) throw new Error('baris tidak ada');
    expect(entryTitleVM(row)).toBe('Jual BBCA · 100 lembar');
    expect(
      codeOf(
        await reject(
          restoreEntry(pribadi, {
            clientId: randomUUID(),
            entryId: row.id,
            expectedVersion: row.version,
          }),
        ),
      ),
    ).toBe('stock_account_trade_only');
    await restoreStockTrade(pribadi, { clientId: randomUUID(), tradeId: jual });
    s = await loadSampah(pribadi);
    expect(s.items).toHaveLength(0);
  });

  it('[T11] Sampah: memulihkan jual sebelum beli yang batal = trade_not_latest (kode terpetakan)', async () => {
    await voidStockTrade(pribadi, { clientId: randomUUID(), tradeId: jual });
    await voidStockTrade(pribadi, { clientId: randomUUID(), tradeId: beli });
    const s = await loadSampah(pribadi);
    expect(s.items.filter((i) => i.entry.trade !== undefined)).toHaveLength(2);
    const e = await reject(restoreStockTrade(pribadi, { clientId: randomUUID(), tradeId: jual }));
    expect(codeOf(e)).toBe('trade_not_latest');
    // urutan benar: beli dulu, lalu jual
    await restoreStockTrade(pribadi, { clientId: randomUUID(), tradeId: beli });
    await restoreStockTrade(pribadi, { clientId: randomUUID(), tradeId: jual });
    expect((await loadSampah(pribadi)).items).toHaveLength(0);
  });

  it('[T11] valuasi aset bisa dibatalkan dan dipulihkan dari Sampah (jalur generik)', async () => {
    const t = await loadTransaksi(pribadi, new Date().toISOString().slice(0, 7));
    const v = t.entries.find((e) => e.kind === 'valuation' && e.trade === undefined);
    if (!v) throw new Error('valuasi tidak ada');
    await voidEntry(pribadi, { clientId: randomUUID(), entryId: v.id, expectedVersion: v.version });
    const s = await loadSampah(pribadi);
    const item = s.items.find((i) => i.entry.id === v.id);
    expect(item && entryTitleVM(item.entry)).toBe('Perubahan nilai · Emas');
  });
});
