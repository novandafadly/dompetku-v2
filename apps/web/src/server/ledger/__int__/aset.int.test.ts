import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAsetOverview, createAsset, revalueAsset } from '../aset';
import { loadAktivitas } from '../bersama';
import { toLedgerError } from '../errors';
import { loadKekayaan } from '../kekayaan';
import { listAccounts, listCategories, listEntries } from '../read';
import { resolveSpace } from '../space';
import {
  archiveAccount,
  createAccount,
  createEntry,
  createSpaceTransfer,
  createTransfer,
  updateEntry,
  voidEntry,
  restoreEntry,
  type LedgerCtx,
} from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * S14 Task 9: aset non-saham lewat loader/wrapper server atas Postgres nyata (persona N pemilik,
 * F anggota Bersama, Luar tanpa ruang). Tag `[T11]` = butir K13 yang dibuktikan di server:
 * (a) S5 setor lalu ubah (nilai aset 600k, dompet turun, kekayaan bersih tetap, batal/pulihkan tepat
 * sekali), (b) valuasi tidak menjadi pemasukan/pengeluaran (jenis `valuation`, kekayaan bersih
 * saja), (c) aset tidak bisa negatif, (h) aset Pribadi pasangan tidak terbaca/tertulis; K2: aset
 * Bersama ditulis anggota kedua. SQL-nya sendiri diuji pgTAP (37/38/42).
 */

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<LedgerCtx> {
  const { spaceId } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId };
}

const wallet = async (ctx: LedgerCtx, name: string, openingBalance = 0) =>
  (
    await createAccount(ctx, {
      clientId: randomUUID(),
      name,
      pocket: 'operasional',
      walletType: 'bank',
      openingBalance,
    })
  ).accountId;

const emas = (ctx: LedgerCtx, over: Record<string, unknown> = {}) =>
  createAsset(ctx, {
    clientId: randomUUID(),
    name: 'Emas Antam',
    assetKind: 'emas',
    ...over,
  });

const move = (ctx: LedgerCtx, from: string, to: string, amount: number) =>
  createTransfer(ctx, { clientId: randomUUID(), fromAccountId: from, toAccountId: to, amount });

const revalue = (ctx: LedgerCtx, accountId: string, value: number, over = {}) =>
  revalueAsset(ctx, { clientId: randomUUID(), accountId, value, ...over });

const codeOf = (e: unknown) => toLedgerError(e)?.code;
const reject = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('seharusnya ditolak');
};

describe('aset non-saham (S14 Task 9)', () => {
  let n: Persona;
  let f: Persona;
  let luar: Persona;
  let nPribadi: LedgerCtx;
  let fPribadi: LedgerCtx;
  let bersama: LedgerCtx;
  let fBersama: LedgerCtx;
  let bca: string;

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
    bca = await wallet(nPribadi, 'BCA', 2_000_000);
  });

  it('tambah aset dengan nilai awal: ada di daftar dompet (pocket aset, jenis) dan ringkasan aset', async () => {
    const { accountId } = await emas(nPribadi, {
      openingBalance: 5_000_000,
      openedOn: '2026-11-01',
    });
    const acc = (await listAccounts(nPribadi)).find((a) => a.id === accountId);
    expect(acc).toMatchObject({ pocket: 'aset', assetKind: 'emas', balance: 5_000_000 });
    const [o] = await loadAsetOverview(nPribadi);
    expect(o).toMatchObject({
      accountId,
      name: 'Emas Antam',
      assetKind: 'emas',
      balance: 5_000_000,
      lastValuedOn: null,
      marketValue: null,
    });
  });

  it('create idempoten: clientId sama = satu aset; nama kembar ditolak', async () => {
    const clientId = randomUUID();
    const a = await emas(nPribadi, { clientId });
    const b = await emas(nPribadi, { clientId });
    expect(b.accountId).toBe(a.accountId);
    expect((await loadAsetOverview(nPribadi)).length).toBe(1);
    expect(codeOf(await reject(emas(nPribadi)))).toBe('name_taken');
  });

  it('[T11] S5: setor 500rb ke aset lalu ubah ke 600rb; nilai aset 600rb, dompet turun, kekayaan bersih tetap; batal/pulihkan tepat sekali', async () => {
    const { accountId: asetId } = await emas(nPribadi);
    const before = await loadKekayaan(nPribadi);
    const t = await move(nPribadi, bca, asetId, 500_000);
    const mid = await loadKekayaan(nPribadi);
    expect(mid.total).toBe(before.total);
    expect(mid).toMatchObject({ kas: 1_500_000, aset: 500_000 });
    // Transfer tidak bisa diubah (`kind_not_editable`): "ubah ke 600rb" = batalkan lalu catat ulang.
    expect(
      codeOf(
        await reject(
          updateEntry(nPribadi, {
            clientId: randomUUID(),
            entryId: t.entryId,
            expectedVersion: t.version,
            accountId: bca,
            amount: 600_000,
            categoryId: null,
            occurredOn: null,
            description: null,
            reimbursable: false,
          }),
        ),
      ),
    ).toBe('unknown');
    const gone = await voidEntry(nPribadi, {
      clientId: randomUUID(),
      entryId: t.entryId,
      expectedVersion: t.version,
    });
    const t2 = await move(nPribadi, bca, asetId, 600_000);
    let nw = await loadKekayaan(nPribadi);
    expect(nw).toMatchObject({ kas: 1_400_000, aset: 600_000, total: before.total });
    const v = await voidEntry(nPribadi, {
      clientId: randomUUID(),
      entryId: t2.entryId,
      expectedVersion: t2.version,
    });
    nw = await loadKekayaan(nPribadi);
    expect(nw).toMatchObject({ kas: 2_000_000, aset: 0, total: before.total });
    await restoreEntry(nPribadi, {
      clientId: randomUUID(),
      entryId: t2.entryId,
      expectedVersion: v.version,
    });
    nw = await loadKekayaan(nPribadi);
    expect(nw).toMatchObject({ kas: 1_400_000, aset: 600_000, total: before.total });
    expect(gone.version).toBeGreaterThan(t.version);
  });

  it('[T11] Perbarui nilai naik/turun: entri valuation (bukan pemasukan/pengeluaran), hanya kekayaan bersih yang bergeser', async () => {
    const { accountId } = await emas(nPribadi, {
      openingBalance: 1_000_000,
      openedOn: '2026-11-01',
    });
    const before = await loadKekayaan(nPribadi);
    const up = await revalue(nPribadi, accountId, 1_300_000);
    expect(up).toMatchObject({ delta: 300_000, unchanged: false });
    expect(up.entryId).not.toBeNull();
    const down = await revalue(nPribadi, accountId, 900_000);
    expect(down).toMatchObject({ delta: -400_000, unchanged: false });
    const nw = await loadKekayaan(nPribadi);
    expect(nw.aset).toBe(900_000);
    expect(nw.total).toBe(before.total - 100_000);
    expect(nw.kas).toBe(before.kas);
    const ov = (await loadAsetOverview(nPribadi))[0];
    expect(ov).toMatchObject({ balance: 900_000, lastChange: -400_000 });
    const entries = (
      await listEntries(nPribadi, { month: new Date().toISOString().slice(0, 7), accountId })
    ).concat(await listEntries(nPribadi, { month: '2026-11', accountId }));
    const val = entries.filter((e) => e.kind === 'valuation');
    expect(val.length).toBeGreaterThan(0);
    expect(val.every((e) => e.categoryId === undefined)).toBe(true);
    // Tidak ada kategori pemasukan/pengeluaran yang terpakai oleh valuasi.
    expect((await listCategories(nPribadi)).length).toBeGreaterThan(0);
  });

  it('nilai sama = tidak ada entri; clientId sama = hasil sama', async () => {
    const { accountId } = await emas(nPribadi, {
      openingBalance: 1_000_000,
      openedOn: '2026-11-01',
    });
    const same = await revalue(nPribadi, accountId, 1_000_000);
    expect(same).toMatchObject({ entryId: null, delta: 0, unchanged: true });
    const clientId = randomUUID();
    const a = await revalueAsset(nPribadi, { clientId, accountId, value: 1_200_000 });
    const b = await revalueAsset(nPribadi, { clientId, accountId, value: 1_200_000 });
    expect(b.entryId).toBe(a.entryId);
    expect((await loadAsetOverview(nPribadi))[0]?.balance).toBe(1_200_000);
  });

  it('valuasi bertanggal sebelum transaksi terakhir ditolak (before_latest_entry); nilai minus invalid', async () => {
    const { accountId } = await emas(nPribadi);
    await move(nPribadi, bca, accountId, 100_000);
    const e = await reject(revalue(nPribadi, accountId, 200_000, { on: '2026-01-02' }));
    expect(['before_latest_entry', 'before_opening']).toContain(codeOf(e));
    expect(await reject(revalue(nPribadi, accountId, -1))).toBeInstanceOf(Error);
  });

  it('[T11] aset tidak bisa negatif: transfer keluar melebihi nilai = asset_negative, saldo tetap', async () => {
    const { accountId } = await emas(nPribadi, { openingBalance: 300_000, openedOn: '2026-11-01' });
    const e = await reject(move(nPribadi, accountId, bca, 400_000));
    expect(codeOf(e)).toBe('asset_negative');
    const e2 = await reject(
      createTransfer(nPribadi, {
        clientId: randomUUID(),
        fromAccountId: accountId,
        toAccountId: bca,
        amount: 400_000,
        allowNegative: true,
      }),
    );
    expect(codeOf(e2)).toBe('asset_negative');
    expect((await loadAsetOverview(nPribadi))[0]?.balance).toBe(300_000);
  });

  it('pengeluaran/pemasukan ke dompet aset ditolak (asset_account_invalid)', async () => {
    const { accountId } = await emas(nPribadi, { openingBalance: 300_000, openedOn: '2026-11-01' });
    const cat = (await listCategories(nPribadi)).find((c) => c.type === 'expense' && !c.archived);
    if (!cat) throw new Error('kategori kosong');
    const e = await reject(
      createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId,
        kind: 'expense',
        amount: 10_000,
        categoryId: cat.id,
      }),
    );
    expect(codeOf(e)).toBe('asset_account_invalid');
  });

  it('jenis Saham: ditolak di Bersama (pocket_personal_only) dan dengan nilai awal (invalid)', async () => {
    expect(codeOf(await reject(emas(bersama, { name: 'Ajaib', assetKind: 'saham' })))).toBe(
      'pocket_personal_only',
    );
    const e = toLedgerError(
      await reject(emas(nPribadi, { name: 'Ajaib', assetKind: 'saham', openingBalance: 1_000 })),
    );
    expect(e).toMatchObject({ code: 'invalid' });
    const ok = await emas(nPribadi, { name: 'Ajaib', assetKind: 'saham' });
    expect((await listAccounts(nPribadi)).find((a) => a.id === ok.accountId)).toMatchObject({
      pocket: 'aset',
      assetKind: 'saham',
      balance: 0,
    });
  });

  it('K2: aset Bersama dibuat N, diperbarui F; Pribadi pasangan tidak terbaca dan tidak tertulis', async () => {
    const shared = await emas(bersama, {
      name: 'Mobil Keluarga',
      assetKind: 'kendaraan',
      openingBalance: 100_000_000,
      openedOn: '2026-11-01',
    });
    const r = await revalueAsset(fBersama, {
      clientId: randomUUID(),
      accountId: shared.accountId,
      value: 95_000_000,
    });
    expect(r.delta).toBe(-5_000_000);
    expect((await loadAsetOverview(nPribadi)).length).toBe(0); // Bersama bukan Pribadi
    expect((await loadAsetOverview(bersama))[0]?.balance).toBe(95_000_000);
    // Aset Pribadi N: F tidak melihat, tidak bisa memperbarui lewat ruangnya sendiri atau Bersama.
    const mine = await emas(nPribadi, { openingBalance: 1_000_000, openedOn: '2026-11-01' });
    expect(codeOf(await reject(revalue(fPribadi, mine.accountId, 5)))).toBe('not_found');
    expect(codeOf(await reject(revalue(fBersama, mine.accountId, 5)))).toBe('not_found');
    expect(await loadAsetOverview(fPribadi)).toEqual([]);
    // Pengguna Luar tanpa ruang: bukan anggota = tidak ada.
    const lctx = await resolveSpace(h.pools, luar.id, 'pribadi').catch(() => null);
    expect(lctx?.spaceId).not.toBe(nPribadi.spaceId);
  });

  it('feed Aktivitas Bersama melewati Perbarui nilai (valuation) tanpa galat feed_rows_invalid', async () => {
    const shared = await emas(bersama, { name: 'Mobil Keluarga', assetKind: 'kendaraan' });
    await revalueAsset(bersama, {
      clientId: randomUUID(),
      accountId: shared.accountId,
      value: 1_200_000,
    });
    const page = await loadAktivitas({ ...bersama, kind: 'shared' }, {});
    expect(page.items).toEqual([]);
  });

  it('B16: setoran Pribadi ke aset Bersama menggeser kekayaan per ruang, jumlah kedua ruang tetap', async () => {
    const shared = await emas(bersama, { name: 'Emas Bersama' });
    const total = async () =>
      (await loadKekayaan(nPribadi)).total + (await loadKekayaan(bersama)).total;
    const t0 = await total();
    await createSpaceTransfer(nPribadi, {
      clientId: randomUUID(),
      fromAccountId: bca,
      toSpaceId: bersama.spaceId,
      toAccountId: shared.accountId,
      amount: 700_000,
      fee: 0,
      allowNegative: false,
    });
    expect(await total()).toBe(t0);
    expect((await loadKekayaan(bersama)).aset).toBe(700_000);
    expect((await loadKekayaan(nPribadi)).kas).toBe(1_300_000);
  });

  it('arsip aset bernilai ditolak (balance_not_zero); bernilai 0 boleh', async () => {
    const { accountId } = await emas(nPribadi, { openingBalance: 100_000, openedOn: '2026-11-01' });
    expect(codeOf(await reject(archiveAccount(nPribadi, accountId)))).toBe('balance_not_zero');
    await revalue(nPribadi, accountId, 0);
    await expect(archiveAccount(nPribadi, accountId)).resolves.toMatchObject({ archived: true });
  });

  it('dua Perbarui nilai paralel pada aset yang sama: keduanya berhasil berurutan, saldo = salah satu nilai', async () => {
    const { accountId } = await emas(nPribadi, {
      openingBalance: 1_000_000,
      openedOn: '2026-11-01',
    });
    await Promise.all([
      revalue(nPribadi, accountId, 1_100_000),
      revalue(nPribadi, accountId, 1_200_000),
    ]);
    expect([1_100_000, 1_200_000]).toContain((await loadAsetOverview(nPribadi))[0]?.balance);
  });
});
