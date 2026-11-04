import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pools } from '@/server/db';
import {
  createLedgerHarness,
  resetLedger,
  seedPersonas,
  spaceIdOf,
  type Persona,
  type Personas,
} from '@/server/ledger/__int__/harness';

/**
 * Jalur action nyata terhadap Postgres: gerbang (sesi di-mock ke persona harness) → resolve ruang
 * di server → Zod → wrapper `api.*`. Hanya `requireDataUser`/`authService` (sesi Better Auth) dan
 * `next/cache` (butuh konteks request Next) yang di-mock.
 */

const session = vi.hoisted(() => ({ userId: '', pools: null as Pools | null }));
const refresh = vi.hoisted(() => vi.fn());

vi.mock('next/cache', () => ({ refresh, revalidatePath: vi.fn() }));
vi.mock('@/server/auth/next', () => ({
  requireDataUser: () => Promise.resolve({ userId: session.userId }),
  authService: () => ({ pools: session.pools }),
}));

const { saveCatat, catatOptions, logCatatEvent } = await import('../catat');
const { createAccountAction } = await import('../dompet');
const { markNoSpendDayAction } = await import('../beranda');
const { voidEntryAction } = await import('../entri');

const h = createLedgerHarness();
session.pools = h.pools;

afterAll(async () => {
  await h.close();
});

function must(p: Persona | null): Persona {
  if (!p) throw new Error('persona tidak ada');
  return p;
}

function as(p: Persona): void {
  session.userId = p.id;
}

async function wallet(
  ruang: 'pribadi' | 'bersama',
  openingBalance: number,
  name = 'BCA',
): Promise<string> {
  const r = await createAccountAction(ruang, {
    clientId: randomUUID(),
    name,
    pocket: 'operasional',
    walletType: 'bank',
    openingBalance,
  });
  if (!r.ok) throw new Error(`dompet gagal: ${r.error.code}`);
  return r.value.accountId;
}

async function expenseCategory(ruang: 'pribadi' | 'bersama'): Promise<string> {
  const r = await catatOptions(ruang);
  if (!r.ok) throw new Error(`opsi gagal: ${r.error.code}`);
  const c = r.value.categories.find((x) => x.type === 'expense' && x.parentId === null);
  if (!c) throw new Error('kategori pengeluaran tidak ada');
  return c.id;
}

describe('server action ruang terhadap DB', () => {
  let ps: Personas;

  beforeEach(async () => {
    await resetLedger(h);
    ps = await seedPersonas(h, { farida: 'bergabung', luar: true });
    refresh.mockClear();
  });

  it('saveCatat: gerbang → resolve → tulis; clientId sama = replayed, satu entri', async () => {
    as(ps.n);
    const accountId = await wallet('pribadi', 500_000);
    const categoryId = await expenseCategory('pribadi');
    const input = {
      kind: 'expense' as const,
      clientId: randomUUID(),
      accountId,
      amount: 35_000,
      categoryId,
    };
    const first = await saveCatat('pribadi', input);
    const again = await saveCatat('pribadi', input);
    expect(first).toMatchObject({ ok: true, value: { version: 1, replayed: false } });
    expect(again).toMatchObject({ ok: true, value: { version: 1, replayed: true } });
    if (!first.ok || !again.ok) throw new Error('simpan gagal');
    expect(again.value.entryId).toBe(first.value.entryId);

    const { rows } = await h.admin.query<{ n: number; space_id: string }>(
      `select count(*)::int as n, min(space_id::text) as space_id
         from app.entries where kind = 'expense'`,
    );
    expect(rows[0]).toEqual({ n: 1, space_id: await spaceIdOf(h, ps.n.id, 'personal') });
    expect(refresh).toHaveBeenCalled();

    const undo = await voidEntryAction('pribadi', {
      clientId: randomUUID(),
      entryId: first.value.entryId,
      expectedVersion: first.value.version,
    });
    expect(undo).toEqual({ ok: true, value: { version: 2 } });
  });

  it('transfer satu ruang lewat saveCatat', async () => {
    as(ps.n);
    const from = await wallet('bersama', 200_000);
    const to = await wallet('bersama', 0, 'Tunai');
    const r = await saveCatat('bersama', {
      kind: 'transfer',
      clientId: randomUUID(),
      fromAccountId: from,
      toAccountId: to,
      amount: 50_000,
    });
    expect(r).toMatchObject({ ok: true, value: { version: 1, replayed: false } });
  });

  it('dompet Pribadi dari rute Bersama = not_found, tanpa entri (Review Focus 4)', async () => {
    as(ps.n);
    const pribadi = await wallet('pribadi', 100_000);
    const categoryId = await expenseCategory('bersama');
    const r = await saveCatat('bersama', {
      kind: 'expense',
      clientId: randomUUID(),
      accountId: pribadi,
      amount: 10_000,
      categoryId,
    });
    expect(r).toEqual({ ok: false, error: { code: 'not_found' } });
    const { rows } = await h.admin.query<{ n: number }>(
      "select count(*)::int as n from app.entries where kind = 'expense'",
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('akun tanpa keanggotaan: ruang tidak ditemukan', async () => {
    as(must(ps.luar));
    await expect(catatOptions('bersama')).resolves.toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    await expect(markNoSpendDayAction('pribadi')).resolves.toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('catatOptions hanya data ruang yang diminta', async () => {
    as(ps.n);
    const pribadi = await wallet('pribadi', 0);
    const bersama = await wallet('bersama', 0);
    const r = await catatOptions('bersama');
    if (!r.ok) throw new Error(r.error.code);
    const ids = r.value.accounts.map((a) => a.id);
    expect(ids).toContain(bersama);
    expect(ids).not.toContain(pribadi);
  });

  it('tombol tanpa pengeluaran ditekan dua kali = satu baris, satu event', async () => {
    as(ps.n);
    expect(await markNoSpendDayAction('bersama')).toEqual({ ok: true, value: undefined });
    expect(await markNoSpendDayAction('bersama')).toEqual({ ok: true, value: undefined });
    const { rows } = await h.admin.query<{ days: number; events: number }>(
      `select (select count(*)::int from app.no_spend_days) as days,
              (select count(*)::int from app.product_events
                where event = 'tanpa_pengeluaran') as events`,
    );
    expect(rows[0]).toEqual({ days: 1, events: 1 });
  });

  it('event Catat dan tanpa_pengeluaran: space_kind dari server, tanpa nominal', async () => {
    as(must(ps.f));
    const flowId = randomUUID();
    await logCatatEvent('bersama', { event: 'catat_dibuka', flowId });
    await logCatatEvent('bersama', {
      event: 'catat_disimpan',
      flowId,
      taps: 3,
      durationMs: 4_000,
    });
    expect(await markNoSpendDayAction('pribadi')).toEqual({ ok: true, value: undefined });
    const { rows } = await h.admin.query<{
      event: string;
      space_kind: string;
      taps: number | null;
    }>('select event, space_kind::text as space_kind, taps from app.product_events order by id');
    expect(rows).toEqual([
      { event: 'catat_dibuka', space_kind: 'shared', taps: null },
      { event: 'catat_disimpan', space_kind: 'shared', taps: 3 },
      { event: 'tanpa_pengeluaran', space_kind: 'personal', taps: null },
    ]);
  });
});
