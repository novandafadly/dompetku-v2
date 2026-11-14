import { randomUUID } from 'node:crypto';
import { todayWIB } from '@dompetku/domain';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAktivitas, sharedActivityTx } from '../bersama';
import { loadBeranda } from '../beranda';
import { toLedgerError } from '../errors';
import {
  createSplit,
  loadPatungan,
  loadPatunganWallets,
  receiveSettlement,
  restoreSplit,
  settleSplit,
  voidReceipt,
  voidSettlement,
  voidSplit,
} from '../patungan';
import { listAccounts, listEntries, recentEntries } from '../read';
import { withLedger } from '../retry';
import { resolveSpace } from '../space';
import { loadTransaksi } from '../transaksi';
import { createAccount, type LedgerCtx } from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * S12 Task 7: server patungan atas Postgres nyata (N pemilik, F pasangan). Saldo antar-anggota,
 * bagian, pelunasan dan terima dari SQL; dompet sistem tidak pernah tampil; Pribadi pasangan
 * tertutup; feed Aktivitas dan Transaksi mengenal baris baru.
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

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('nilai tidak ada');
  return v;
}

async function categoryOf(ctx: LedgerCtx): Promise<string> {
  const { rows } = await h.admin.query<{ id: string }>(
    `select id from app.categories
      where space_id = $1 and type = 'expense' and parent_id is null
      order by sort_order, id limit 1`,
    [ctx.spaceId],
  );
  return must(rows[0]?.id);
}

const wallet = async (ctx: LedgerCtx, name: string, openingBalance: number) =>
  (
    await createAccount(ctx, {
      clientId: randomUUID(),
      name,
      pocket: 'operasional',
      walletType: 'bank',
      openingBalance,
    })
  ).accountId;

describe('bagi tagihan Bersama (S12 Task 7)', () => {
  let n: Persona;
  let f: Persona;
  let nPribadi: Ctx;
  let fPribadi: Ctx;
  let bersama: Ctx;
  let fBersama: Ctx;
  let bca: string;
  let cimb: string;
  let cat: string;

  const split = (amount: number, extra: Record<string, unknown> = {}) =>
    createSplit(bersama, {
      clientId: randomUUID(),
      accountId: bca,
      amount,
      categoryId: cat,
      description: 'Listrik',
      ...extra,
    });

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    n = ps.n;
    f = must(ps.f);
    nPribadi = await ctxOf(n, 'pribadi');
    fPribadi = await ctxOf(f, 'pribadi');
    bersama = await ctxOf(n, 'bersama');
    fBersama = await ctxOf(f, 'bersama');
    bca = await wallet(nPribadi, 'BCA', 1_000_000);
    cimb = await wallet(fPribadi, 'CIMB', 500_000);
    cat = await categoryOf(bersama);
  });

  it('sama rata: bagian dan saldo dari SQL, sisa ganjil ke pembayar; dompet sistem tak tampil', async () => {
    const r = await split(400_001);
    expect(r.shares.map((s) => [s.userId, s.amount]).sort()).toEqual(
      [
        [n.id, 200_001],
        [f.id, 200_000],
      ].sort(),
    );
    const data = await loadPatungan(bersama);
    expect(data.balance).toMatchObject({
      debtorId: f.id,
      creditorId: n.id,
      amount: 200_000,
      splitCount: 1,
      settlementCount: 0,
      pending: [],
    });
    expect(data.balance?.partner.name).toBe('Farida');
    expect(data.history).toHaveLength(1);
    expect(data.history[0]).toMatchObject({
      item: 'split',
      payerId: n.id,
      amount: 400_001,
      description: 'Listrik',
    });
    // Saldo BCA turun tepat sekali; dompet sistem tidak ada di daftar dompet Bersama.
    expect((await listAccounts(nPribadi)).find((a) => a.id === bca)?.balance).toBe(599_999);
    expect(await listAccounts(bersama)).toEqual([]);
  });

  it('nominal bagian atur sendiri; Σ ≠ total = invalid shares', async () => {
    const r = await split(400_000, {
      shares: [
        { userId: n.id, amount: 250_000 },
        { userId: f.id, amount: 150_000 },
      ],
    });
    expect(r.shares.find((s) => s.userId === f.id)?.amount).toBe(150_000);
    expect((await loadPatungan(bersama)).balance?.amount).toBe(150_000);
    const bad = await split(100_000, {
      shares: [
        { userId: n.id, amount: 10 },
        { userId: f.id, amount: 20 },
      ],
    }).catch((e: unknown) => e);
    expect(toLedgerError(bad)).toEqual({ code: 'invalid', field: 'shares' });
  });

  it('Transaksi Bersama: pengeluaran berlabel patungan tanpa kaki dompet sistem; Pribadi: Bayar untuk Bersama', async () => {
    await split(400_000);
    const month = todayWIB().slice(0, 7);
    const shared = await loadTransaksi(bersama, month);
    expect(shared.entries).toHaveLength(1);
    expect(shared.entries[0]).toMatchObject({
      kind: 'expense',
      amount: 400_000,
      split: { role: 'bill', payerName: 'Novanda' },
      accountName: 'Dibayar dari dompet pribadi Novanda',
    });
    expect(JSON.stringify(shared)).not.toContain('Patungan');
    expect((await recentEntries(bersama, 5)).map((e) => e.kind)).toEqual(['expense']);
    // Farida melihat hal yang sama, tanpa nama dompet Pribadi Novanda.
    const forF = await listEntries(fBersama, { month });
    expect(JSON.stringify(forF)).not.toContain('BCA');
    const pribadi = await listEntries(nPribadi, { month });
    const leg = pribadi.find((e) => e.kind === 'space_transfer');
    expect(leg).toMatchObject({ split: { role: 'bill' }, direction: 'out', accountName: 'BCA' });
    // Pribadi Farida tidak tersentuh.
    expect(
      (await listEntries(fPribadi, { month })).filter((e) => e.kind !== 'opening_balance'),
    ).toEqual([]);
  });

  it('pelunasan: sisa dari SQL, bayar lebih ditolak, terima, batal terima, batal pelunasan', async () => {
    await split(400_000);
    const over = await settleSplit(fBersama, {
      clientId: randomUUID(),
      accountId: cimb,
      amount: 200_001,
    }).catch((e: unknown) => e);
    expect(toLedgerError(over)).toEqual({ code: 'payment_exceeds' });

    const s = await settleSplit(fBersama, {
      clientId: randomUUID(),
      accountId: cimb,
      amount: 150_000,
    });
    expect(s).toMatchObject({ amount: 150_000, remaining: 50_000 });
    let data = await loadPatungan(bersama);
    expect(data.balance).toMatchObject({ amount: 50_000, settlementCount: 1 });
    expect(data.balance?.pending).toEqual([
      expect.objectContaining({
        id: s.settlementId,
        fromId: f.id,
        toId: n.id,
        amount: 150_000,
      }),
    ]);
    expect((await listAccounts(fPribadi)).find((a) => a.id === cimb)?.balance).toBe(350_000);

    // Penerima menerima ke BCA; pelunas tidak bisa membatalkan lagi.
    const recv = await receiveSettlement(bersama, {
      clientId: randomUUID(),
      settlementId: s.settlementId,
      accountId: bca,
    });
    expect(recv.amount).toBe(150_000);
    expect((await listAccounts(nPribadi)).find((a) => a.id === bca)?.balance).toBe(750_000);
    expect((await loadPatungan(bersama)).balance?.pending).toEqual([]);
    const blocked = await voidSettlement(fBersama, {
      clientId: randomUUID(),
      settlementId: s.settlementId,
    }).catch((e: unknown) => e);
    expect(toLedgerError(blocked)).toEqual({ code: 'settlement_received' });

    // Label kaki Pribadi dan kaki Bersama tersembunyi.
    const month = todayWIB().slice(0, 7);
    expect(
      (await listEntries(fPribadi, { month })).find((e) => e.kind === 'space_transfer')?.split,
    ).toEqual({ role: 'settle' });
    expect(
      (await listEntries(nPribadi, { month })).filter((e) => e.split?.role === 'receive'),
    ).toHaveLength(1);
    expect((await listEntries(bersama, { month })).map((e) => e.kind)).toEqual(['expense']);

    // Penerima batal terima: uang kembali menunggu; saldo patungan tidak berubah.
    await voidReceipt(bersama, { clientId: randomUUID(), settlementId: s.settlementId });
    data = await loadPatungan(bersama);
    expect(data.balance?.amount).toBe(50_000);
    expect(data.balance?.pending).toHaveLength(1);
    await voidSettlement(fBersama, { clientId: randomUUID(), settlementId: s.settlementId });
    data = await loadPatungan(bersama);
    expect(data.balance?.amount).toBe(200_000);
    expect((await listAccounts(fPribadi)).find((a) => a.id === cimb)?.balance).toBe(500_000);
  });

  it('impas: tanpa arah dan tanpa nominal; terima oleh bukan penerima = not_found', async () => {
    await split(400_000);
    const s = await settleSplit(fBersama, {
      clientId: randomUUID(),
      accountId: cimb,
      amount: 200_000,
    });
    const data = await loadPatungan(bersama);
    expect(data.balance).toMatchObject({
      debtorId: null,
      creditorId: null,
      amount: null,
      splitCount: 1,
      settlementCount: 1,
    });
    const wrong = await receiveSettlement(fBersama, {
      clientId: randomUUID(),
      settlementId: s.settlementId,
      accountId: cimb,
    }).catch((e: unknown) => e);
    expect(toLedgerError(wrong)).toEqual({ code: 'not_found' });
  });

  it('hapus dan pulihkan tagihan: hanya pembayar; dihapus tampil hanya untuknya', async () => {
    const r = await split(400_000);
    const byF = await voidSplit(fBersama, { clientId: randomUUID(), splitId: r.splitId }).catch(
      (e: unknown) => e,
    );
    expect(toLedgerError(byF)).toEqual({ code: 'not_found' });

    const v = await voidSplit(bersama, { clientId: randomUUID(), splitId: r.splitId });
    expect(v.effects).toEqual([{ accountName: 'BCA', amount: 400_000 }]);
    expect((await listAccounts(nPribadi)).find((a) => a.id === bca)?.balance).toBe(1_000_000);
    const mine = await loadPatungan(bersama);
    expect(mine.history).toEqual([]);
    expect(mine.deleted).toHaveLength(1);
    expect(mine.deleted[0]?.purgeAfter).not.toBeNull();
    expect(mine.balance).toMatchObject({ amount: null, splitCount: 0 });
    // Farida tidak melihat tagihan yang dihapus.
    const theirs = await loadPatungan(fBersama);
    expect(theirs.deleted).toEqual([]);

    await restoreSplit(bersama, { clientId: randomUUID(), splitId: r.splitId });
    expect((await loadPatungan(bersama)).balance?.amount).toBe(200_000);
  });

  it('dompet Pribadi dan label dialog hanya milik pemanggil; Pribadi tidak punya fitur ini', async () => {
    const r = await split(400_000);
    const s = await settleSplit(fBersama, {
      clientId: randomUUID(),
      accountId: cimb,
      amount: 100_000,
    });
    const mine = await loadPatunganWallets(bersama);
    expect(mine.accounts.map((a) => a.name)).toEqual(['BCA']);
    expect(mine.linked[r.splitId]).toEqual({ name: 'BCA', balance: 600_000 });
    // Pelunasan milik F: N hanya melihat dompet miliknya (kaki terima belum ada).
    expect(mine.linked[s.settlementId]).toBeUndefined();
    const theirs = await loadPatunganWallets(fBersama);
    expect(theirs.accounts.map((a) => a.name)).toEqual(['CIMB']);
    expect(theirs.linked[s.settlementId]).toEqual({ name: 'CIMB', balance: 400_000 });
    expect(theirs.linked[r.splitId]).toBeUndefined();

    // Pribadi: tidak ada halaman, tidak ada tulis.
    await expect(loadPatungan(nPribadi)).rejects.toThrow();
    await expect(loadPatunganWallets(nPribadi)).rejects.toThrow();
    const e = await createSplit(nPribadi, {
      clientId: randomUUID(),
      accountId: bca,
      amount: 1000,
      categoryId: await categoryOf(nPribadi),
    }).catch((x: unknown) => x);
    expect(toLedgerError(e)).toEqual({ code: 'split_shared_only' });
  });

  it('dompet Pribadi pasangan ditolak tanpa bocor; Kantor/Trading tidak boleh', async () => {
    const e = await split(10_000, { accountId: cimb }).catch((x: unknown) => x);
    expect(toLedgerError(e)).toEqual({ code: 'not_found' });
    const kantor = (
      await createAccount(nPribadi, {
        clientId: randomUUID(),
        name: 'Kas Kantor',
        pocket: 'kantor',
        walletType: 'cash',
        openingBalance: 100_000,
      })
    ).accountId;
    const e2 = await split(10_000, { accountId: kantor }).catch((x: unknown) => x);
    expect(toLedgerError(e2)).toEqual({ code: 'split_account_invalid' });
  });

  it('saldo kurang: saldo_negatif sampai allowNegative', async () => {
    const e = await split(2_000_000).catch((x: unknown) => x);
    expect(toLedgerError(e)).toEqual({ code: 'saldo_negatif' });
    await split(2_000_000, { allowNegative: true });
    expect((await listAccounts(nPribadi)).find((a) => a.id === bca)?.balance).toBe(-1_000_000);
  });

  it('idempoten: clientId sama = satu tagihan', async () => {
    const clientId = randomUUID();
    const a = await split(50_000, { clientId });
    const b = await split(50_000, { clientId });
    expect(b.replayed).toBe(true);
    expect(b.splitId).toBe(a.splitId);
    expect((await loadPatungan(bersama)).history).toHaveLength(1);
  });

  it('feed Aktivitas: satu baris pembayaran dari dompet pribadi, kaki dompet sistem tersembunyi', async () => {
    await split(400_000);
    const s = await settleSplit(fBersama, {
      clientId: randomUUID(),
      accountId: cimb,
      amount: 100_000,
    });
    await receiveSettlement(bersama, {
      clientId: randomUUID(),
      settlementId: s.settlementId,
      accountId: bca,
    });
    const page = await loadAktivitas(bersama);
    expect(page.items.map((i) => i.text)).toEqual(['membayar Listrik dari dompet pribadi']);
    expect(page.next).toBeNull();
    expect(JSON.stringify(page)).not.toContain('Patungan');
    expect(JSON.stringify(page)).not.toContain('BCA');
  });

  it('feed Aktivitas: halaman diisi ulang bila kaki disembunyikan (limit tercapai tanpa celah)', async () => {
    for (let i = 0; i < 4; i += 1) await split(10_000 + i, { description: `Tagihan ${String(i)}` });
    const s = await settleSplit(fBersama, {
      clientId: randomUUID(),
      accountId: cimb,
      amount: 10_000,
    });
    await receiveSettlement(bersama, {
      clientId: randomUUID(),
      settlementId: s.settlementId,
      accountId: bca,
    });
    const page = await withLedger(h.pools, n.id, bersama.spaceId, (c) =>
      sharedActivityTx(c, bersama, { limit: 3 }),
    );
    expect(page.items).toHaveLength(3);
    expect(page.next).not.toBeNull();
    const rest = await withLedger(h.pools, n.id, bersama.spaceId, (c) =>
      sharedActivityTx(c, bersama, { limit: 3, before: page.next }),
    );
    expect(rest.items).toHaveLength(1);
    expect(rest.next).toBeNull();
  });

  it('Beranda Bersama memuat saldo patungan; Pribadi tidak', async () => {
    await split(400_000);
    const b = await loadBeranda(bersama);
    expect(b.bersama?.split).toMatchObject({ amount: 200_000, debtorId: f.id });
    const p = await loadBeranda(nPribadi);
    expect(p.bersama).toBeNull();
  });
});
