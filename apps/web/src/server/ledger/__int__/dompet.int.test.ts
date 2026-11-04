import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { toLedgerError } from '../errors';
import { loadDompetDaftar, loadDompetRiwayat } from '../dompet';
import { listAccounts, listCategories } from '../read';
import { resolveSpace } from '../space';
import {
  archiveAccount,
  archiveCategory,
  createAccount,
  createCategory,
  createEntry,
  createTransfer,
  updateCategory,
  voidEntry,
  type LedgerCtx,
} from '../write';
import { createReimbursement } from '../reimburse';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * Jalur data Dompet nyata (page `[ruang]/dompet` dan `[ruang]/dompet/[id]`) dan pengelolaan
 * kategori (Menu → Kategori): saldo awal dari `account_balances`, riwayat per dompet, dan galat
 * kategori yang punya teks sendiri (nama ganda, kedalaman). Hanya data ruang ini (Review Focus 4).
 */

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

const KANARI_DOMPET = 'KANARI-DOMPET-RIWAYAT';

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<LedgerCtx> {
  const { spaceId } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId };
}

async function wallet(ctx: LedgerCtx, name: string, openingBalance: number): Promise<string> {
  const { accountId } = await createAccount(ctx, {
    clientId: randomUUID(),
    name,
    pocket: 'operasional',
    walletType: 'bank',
    openingBalance,
  });
  return accountId;
}

/** Seperti page: dompet ruang ini dimuat dulu (di app dari cache layout), lalu diberikan ke loader. */
async function muatRiwayat(ctx: LedgerCtx, accountId: string, shown: number) {
  return loadDompetRiwayat(ctx, accountId, shown, await listAccounts(ctx));
}

async function firstExpenseCategory(ctx: LedgerCtx): Promise<string> {
  const c = (await listCategories(ctx)).find((x) => x.type === 'expense' && x.parentId === null);
  if (!c) throw new Error('kategori awal tidak ada');
  return c.id;
}

async function expense(ctx: LedgerCtx, accountId: string, amount: number) {
  return createEntry(ctx, {
    clientId: randomUUID(),
    accountId,
    kind: 'expense',
    amount,
    categoryId: await firstExpenseCategory(ctx),
  });
}

describe('Dompet nyata (persona N, F bergabung)', () => {
  let n: Persona;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    n = ps.n;
  });

  it('dompet dengan saldo hari ini tampil di daftar dengan saldo itu; tanpa saldo = 0 tanpa entri', async () => {
    const ctx = await ctxOf(n, 'pribadi');
    const bca = await wallet(ctx, 'BCA', 1_250_000);
    const tunai = await wallet(ctx, 'Tunai', 0);
    const list = await listAccounts(ctx);
    expect(list.find((a) => a.id === bca)).toMatchObject({ name: 'BCA', balance: 1_250_000 });
    expect(list.find((a) => a.id === tunai)).toMatchObject({ name: 'Tunai', balance: 0 });
    const riwayat = await muatRiwayat(ctx, bca, 50);
    expect(riwayat?.opening).toHaveLength(1);
    expect(riwayat?.opening[0]).toMatchObject({ kind: 'opening_balance', amount: 1_250_000 });
    expect((await muatRiwayat(ctx, tunai, 50))?.opening).toEqual([]);
  });

  it('riwayat: terbaru dulu, batas halaman + hasMore, transfer terlihat di kedua dompet, batal hilang', async () => {
    const ctx = await ctxOf(n, 'pribadi');
    const a = await wallet(ctx, KANARI_DOMPET, 10_000_000);
    const b = await wallet(ctx, 'Tabungan', 0);
    const e1 = await expense(ctx, a, 1_000);
    await expense(ctx, a, 2_000);
    await expense(ctx, a, 3_000);
    await createTransfer(ctx, {
      clientId: randomUUID(),
      fromAccountId: a,
      toAccountId: b,
      amount: 500_000,
    });
    await voidEntry(ctx, { clientId: randomUUID(), entryId: e1.entryId, expectedVersion: 1 });

    const all = await muatRiwayat(ctx, a, 50);
    expect(all?.account).toMatchObject({
      name: KANARI_DOMPET,
      balance: 10_000_000 - 5_000 - 500_000,
    });
    expect(all?.entries.map((e) => e.kind).sort()).toEqual(['expense', 'expense', 'transfer']);
    expect(all?.entries.some((e) => e.id === e1.entryId)).toBe(false);
    expect(all?.hasMore).toBe(false);

    const page = await muatRiwayat(ctx, a, 2);
    expect(page?.entries).toHaveLength(2);
    expect(page?.hasMore).toBe(true);
    // Saldo awal tidak ikut hitungan halaman.
    expect(page?.opening).toHaveLength(1);

    // Dompet lawan transfer melihat entrinya juga (sebagai lawan).
    const lawan = await muatRiwayat(ctx, b, 50);
    expect(lawan?.entries.map((e) => e.kind)).toEqual(['transfer']);
  });

  it('bukan uuid, tidak ada, atau dompet ruang lain = null (tidak membocorkan Pribadi dari Bersama)', async () => {
    const pribadi = await ctxOf(n, 'pribadi');
    const bersama = await ctxOf(n, 'bersama');
    const a = await wallet(pribadi, KANARI_DOMPET, 1_000);
    expect(await muatRiwayat(pribadi, 'bukan-uuid', 50)).toBeNull();
    expect(await muatRiwayat(pribadi, randomUUID(), 50)).toBeNull();
    expect(await muatRiwayat(bersama, a, 50)).toBeNull();
    expect(await muatRiwayat(pribadi, a, 50)).not.toBeNull();
  });
});

describe('Dompet nyata S7: terarsip dan Menunggu reimburse', () => {
  let n: Persona;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    n = ps.n;
  });

  const kind = (ruang: 'pribadi' | 'bersama') => (ruang === 'pribadi' ? 'personal' : 'shared');

  async function talangan(ctx: LedgerCtx, accountId: string, amount: number, desc: string) {
    return createEntry(ctx, {
      clientId: randomUUID(),
      accountId,
      kind: 'expense',
      amount,
      categoryId: await firstExpenseCategory(ctx),
      description: desc,
      reimbursable: true,
    });
  }

  it('dompet terarsip (saldo 0) tidak di daftar aktif; muncul di archived dan riwayatnya tetap terbuka', async () => {
    const ctx = await ctxOf(n, 'pribadi');
    const aktif = await wallet(ctx, 'BCA', 100_000);
    const lama = await wallet(ctx, 'Dompet Lama', 0);
    await archiveAccount(ctx, lama);

    expect((await listAccounts(ctx)).map((a) => a.id)).toEqual([aktif]);
    const daftar = await loadDompetDaftar(ctx, 'personal');
    expect(daftar.archived).toEqual([
      expect.objectContaining({ id: lama, name: 'Dompet Lama', archived: true, balance: 0 }),
    ]);
    // Riwayat dompet terarsip tetap bisa dibuka (tautan dari kartu Diarsipkan).
    const riwayat = await muatRiwayat(ctx, lama, 50);
    expect(riwayat?.account).toMatchObject({ id: lama, archived: true });
    // Tetap terkurung per ruang: dari Bersama dompet Pribadi (terarsip pun) = null.
    expect(await muatRiwayat(await ctxOf(n, 'bersama'), lama, 50)).toBeNull();
  });

  it('terarsip hanya milik ruang ini: Bersama tidak melihat dompet terarsip Pribadi', async () => {
    const pribadi = await ctxOf(n, 'pribadi');
    const bersama = await ctxOf(n, 'bersama');
    await archiveAccount(pribadi, await wallet(pribadi, KANARI_DOMPET, 0));
    const daftar = await loadDompetDaftar(bersama, 'shared');
    expect(daftar.archived).toEqual([]);
    expect(JSON.stringify(daftar)).not.toContain(KANARI_DOMPET);
  });

  it('Pribadi: talangan dengan sisa tampil (sebagian diganti = sisa), lunas hilang', async () => {
    const ctx = await ctxOf(n, 'pribadi');
    const bca = await wallet(ctx, 'BCA', 10_000_000);
    const t1 = await talangan(ctx, bca, 500_000, 'Tiket dinas');
    const t2 = await talangan(ctx, bca, 200_000, 'Taksi dinas');
    await createReimbursement(ctx, {
      clientId: randomUUID(),
      entryId: t1.entryId,
      accountId: bca,
      amount: 300_000,
    });
    await createReimbursement(ctx, {
      clientId: randomUUID(),
      entryId: t2.entryId,
      accountId: bca,
      amount: 200_000,
    });
    const daftar = await loadDompetDaftar(ctx, kind('pribadi'));
    expect(daftar.reimbursables).toEqual([
      expect.objectContaining({
        entryId: t1.entryId,
        description: 'Tiket dinas',
        categoryName: expect.any(String) as string,
        amount: 500_000,
        reimbursed: 300_000,
        remaining: 200_000,
      }),
    ]);
  });

  it('Bersama: reimbursables kosong dan kueri talangan tidak dijalankan', async () => {
    const pribadi = await ctxOf(n, 'pribadi');
    const bca = await wallet(pribadi, KANARI_DOMPET, 5_000_000);
    await talangan(pribadi, bca, 123_457, 'KANARI-TALANGAN');
    const bersama = await ctxOf(n, 'bersama');
    const daftar = await loadDompetDaftar(bersama, 'shared');
    expect(daftar.reimbursables).toEqual([]);
    expect(JSON.stringify(daftar)).not.toMatch(/KANARI|123457/);
  });
});

describe('Kategori nyata: galat yang punya teks sendiri', () => {
  let n: Persona;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    n = ps.n;
  });

  const make = (ctx: LedgerCtx, name: string, parentId?: string) =>
    createCategory(ctx, {
      clientId: randomUUID(),
      type: 'expense',
      name,
      icon: 'Tag',
      ...(parentId === undefined ? {} : { parentId }),
    });

  it('nama ganda (beda huruf) = name_taken; nama sama di induk lain boleh', async () => {
    const ctx = await ctxOf(n, 'pribadi');
    const induk = await make(ctx, 'Anak Kos');
    await make(ctx, 'Parkir', induk.categoryId);
    const dup = await make(ctx, 'parkir', induk.categoryId).catch((e: unknown) => e);
    expect(toLedgerError(dup)).toEqual({ code: 'name_taken' });
    // Di akar, nama yang sama dengan anak itu bukan duplikat.
    await expect(make(ctx, 'Parkir')).resolves.toBeDefined();
  });

  it('menjadikan kategori bersubkategori anak = category_depth; ubah nama + ikon + arsip jalan', async () => {
    const ctx = await ctxOf(n, 'pribadi');
    const induk = await make(ctx, 'Induk');
    const anak = await make(ctx, 'Anak', induk.categoryId);
    const lain = await make(ctx, 'Lain');
    const depth = await updateCategory(ctx, {
      categoryId: induk.categoryId,
      name: 'Induk',
      icon: 'Tag',
      parentId: lain.categoryId,
    }).catch((e: unknown) => e);
    expect(toLedgerError(depth)).toEqual({ code: 'category_depth' });

    await updateCategory(ctx, {
      categoryId: anak.categoryId,
      name: 'Anak baru',
      icon: 'Coffee',
      parentId: induk.categoryId,
    });
    const after = (await listCategories(ctx)).find((c) => c.id === anak.categoryId);
    expect(after).toMatchObject({ name: 'Anak baru', icon: 'Coffee', parentId: induk.categoryId });

    const r = await archiveCategory(ctx, { categoryId: induk.categoryId });
    expect(r.affected).toBe(2);
    const ids = (await listCategories(ctx)).map((c) => c.id);
    expect(ids).not.toContain(induk.categoryId);
    expect(ids).not.toContain(anak.categoryId);
  });
});
