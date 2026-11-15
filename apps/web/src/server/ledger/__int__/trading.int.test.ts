import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDompetDaftar } from '../dompet';
import { toLedgerError } from '../errors';
import { listAccounts, listCategories } from '../read';
import { resolveSpace } from '../space';
import { loadTrading } from '../trading';
import {
  createAccount,
  createEntry,
  createTransfer,
  restoreEntry,
  voidEntry,
  type LedgerCtx,
} from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * S12 Task 5: `api.trading_overview` lewat `loadTrading` (angka dari SQL), setor/tarik = transfer
 * biasa, Trading ditolak di Bersama, dan dompet sistem `patungan` tidak pernah ikut daftar dompet.
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

const wallet = async (
  ctx: LedgerCtx,
  name: string,
  pocket: 'operasional' | 'tabungan' | 'kantor' | 'trading',
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

const move = (ctx: LedgerCtx, from: string, to: string, amount: number) =>
  createTransfer(ctx, { clientId: randomUUID(), fromAccountId: from, toAccountId: to, amount });

describe('modal trading (S12 Task 5)', () => {
  let n: Persona;
  let pribadi: Ctx;
  let bca: string;
  let stockbit: string;

  let seedFarida: () => Promise<Persona>;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    n = ps.n;
    seedFarida = () => {
      if (!ps.f) throw new Error('Farida tidak ada');
      return Promise.resolve(ps.f);
    };
    pribadi = await ctxOf(n, 'pribadi');
    bca = await wallet(pribadi, 'BCA', 'operasional', 10_000_000);
    stockbit = await wallet(pribadi, 'Stockbit', 'trading');
  });

  it('tanpa setoran: satu dompet, hasDeposit false, total nol dan selalu ada', async () => {
    const t = await loadTrading(pribadi);
    expect(t.accounts).toHaveLength(1);
    expect(t.accounts[0]).toMatchObject({ id: stockbit, name: 'Stockbit', hasDeposit: false });
    expect(t.total).toMatchObject({
      capitalIn: 0,
      capitalLeft: 0,
      shortfall: 0,
      hasDeposit: false,
    });
  });

  it('setor, tarik sebagian, tarik di atas modal: sisa, hasil ditarik, Kurang dari SQL; void/restore menggeser tepat sekali', async () => {
    await move(pribadi, bca, stockbit, 5_000_000);
    let t = await loadTrading(pribadi);
    expect(t.accounts[0]).toMatchObject({
      balance: 5_000_000,
      capitalIn: 5_000_000,
      capitalOut: 0,
      capitalLeft: 5_000_000,
      realized: 0,
      shortfall: 0,
      hasDeposit: true,
    });
    // Saldo trading turun karena rugi (penyesuaian), bukan penarikan: Kurang muncul tepat di batas.
    await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: stockbit,
      kind: 'expense',
      amount: 1_200_000,
      categoryId: await firstExpenseCategory(pribadi),
    });
    t = await loadTrading(pribadi);
    expect(t.accounts[0]).toMatchObject({
      balance: 3_800_000,
      capitalLeft: 5_000_000,
      shortfall: 1_200_000,
    });
    expect(t.total.shortfall).toBe(1_200_000);

    const tarik = await move(pribadi, stockbit, bca, 1_000_000);
    t = await loadTrading(pribadi);
    expect(t.accounts[0]).toMatchObject({
      capitalOut: 1_000_000,
      capitalLeft: 4_000_000,
      shortfall: 1_200_000,
    });
    await voidEntry(pribadi, {
      clientId: randomUUID(),
      entryId: tarik.entryId,
      expectedVersion: 1,
    });
    t = await loadTrading(pribadi);
    expect(t.accounts[0]).toMatchObject({ capitalOut: 0, capitalLeft: 5_000_000 });
    await restoreEntry(pribadi, {
      clientId: randomUUID(),
      entryId: tarik.entryId,
      expectedVersion: 2,
    });
    t = await loadTrading(pribadi);
    expect(t.accounts[0]).toMatchObject({ capitalOut: 1_000_000, capitalLeft: 4_000_000 });
  });

  it('tarik di atas modal = hasil ditarik, sisa 0', async () => {
    await move(pribadi, bca, stockbit, 1_000_000);
    await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: stockbit,
      kind: 'income',
      amount: 500_000,
      categoryId: await firstIncomeCategory(pribadi),
    });
    await move(pribadi, stockbit, bca, 1_500_000);
    const t = await loadTrading(pribadi);
    expect(t.accounts[0]).toMatchObject({
      balance: 0,
      capitalLeft: 0,
      realized: 500_000,
      shortfall: 0,
    });
  });

  it('transfer antar dua dompet trading tidak dihitung setor/tarik', async () => {
    const ajaib = await wallet(pribadi, 'Ajaib', 'trading');
    await move(pribadi, bca, stockbit, 2_000_000);
    await move(pribadi, stockbit, ajaib, 500_000);
    const t = await loadTrading(pribadi);
    expect(t.total).toMatchObject({ capitalIn: 2_000_000, capitalOut: 0, capitalLeft: 2_000_000 });
  });

  it('Bersama: Trading ditolak pocket_personal_only; loader Bersama = galat, bukan data', async () => {
    const bersama = await ctxOf(n, 'bersama');
    const err = await wallet(bersama, 'Saham', 'trading').catch((e: unknown) => e);
    expect(toLedgerError(err)).toEqual({ code: 'pocket_personal_only' });
    const load = await loadTrading(bersama).catch((e: unknown) => e);
    expect(toLedgerError(load)).toEqual({ code: 'pocket_personal_only' });
  });

  it('Pribadi pasangan tidak terbaca: ruang bukan miliknya = not_found', async () => {
    const f = (await seedFarida()).id;
    const e = await loadTrading({ ...pribadi, userId: f }).catch((x: unknown) => x);
    expect(toLedgerError(e)).toEqual({ code: 'not_found' });
  });

  it('dompet sistem patungan tidak ada di daftar dompet maupun daftar terarsip', async () => {
    const bersama = await ctxOf(n, 'bersama');
    // Dompet sistem hanya boleh dibuat di dalam konteks `private.split_ctx` (0135).
    const c = await h.admin.connect();
    try {
      await c.query('begin');
      await c.query('insert into private.split_ctx values (pg_catalog.pg_current_xact_id())');
      await c.query(
        `insert into app.accounts (space_id, space_kind, name, pocket, wallet_type, opened_on, created_by)
         values ($1, 'shared', 'Patungan', 'patungan', 'cash', date '2000-01-01', $2)`,
        [bersama.spaceId, n.id],
      );
      await c.query('delete from private.split_ctx where xid = pg_catalog.pg_current_xact_id()');
      await c.query('commit');
    } finally {
      c.release();
    }
    expect((await listAccounts(bersama)).map((a) => a.pocket)).not.toContain('patungan');
    expect((await loadDompetDaftar(bersama, 'shared')).archived).toEqual([]);
    // Pribadi: trading dan operasional tampil.
    expect((await listAccounts(pribadi)).map((a) => a.pocket).sort()).toEqual([
      'operasional',
      'trading',
    ]);
  });
});

async function firstCategory(ctx: LedgerCtx, type: 'income' | 'expense'): Promise<string> {
  const c = (await listCategories(ctx)).find((x) => x.type === type && x.parentId === null);
  if (!c) throw new Error('kategori awal tidak ada');
  return c.id;
}
const firstExpenseCategory = (ctx: LedgerCtx) => firstCategory(ctx, 'expense');
const firstIncomeCategory = (ctx: LedgerCtx) => firstCategory(ctx, 'income');
