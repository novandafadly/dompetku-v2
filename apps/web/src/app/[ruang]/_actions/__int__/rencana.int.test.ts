import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pools } from '@/server/db';
import { createLedgerHarness, memuatNominal, resetLedger } from '@/server/ledger/__int__/harness';
import {
  categoryNamed,
  clockEnv,
  ctxAt,
  KANARI,
  seedS9,
  TODAY,
  type Clock,
  type S9Fixture,
} from '@/server/ledger/__int__/s9';
import { loadRencana } from '@/server/ledger/rencana';

/**
 * Server Action Rencana (S9 Task 9) terhadap Postgres nyata: gerbang (sesi di-mock ke persona) →
 * resolve ruang → Zod → wrapper `api.*` → pemetaan galat. Jam DB tiruan (`s9.ts`).
 */

const session = vi.hoisted(() => ({ userId: '', pools: null as Pools | null }));
const refresh = vi.hoisted(() => vi.fn());

vi.mock('next/cache', () => ({ refresh, revalidatePath: vi.fn() }));
vi.mock('@/server/auth/next', () => ({
  requireDataUser: () => Promise.resolve({ userId: session.userId }),
  authService: () => ({ pools: session.pools }),
}));

const a = await import('../rencana');

const h = createLedgerHarness();
let clock: Clock;
let fx: S9Fixture;

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetLedger(h);
  clock = await clockEnv(h);
  fx = await seedS9(h, clock);
  session.pools = clock.at(TODAY);
  session.userId = fx.n.id;
  refresh.mockClear();
});

afterEach(async () => {
  await clock.restore();
});

async function firstOccurrence(ruang: 'pribadi' | 'bersama'): Promise<string> {
  if (!session.pools) throw new Error('pools');
  const r = await loadRencana(await ctxAt(session.pools, fx.n, ruang));
  const id = r.due[0]?.occurrenceId;
  if (!id) throw new Error('kemunculan tidak ada');
  return id;
}

describe('action Rencana terhadap DB', () => {
  it('obligation_double dari kedua arah: kode saja, tanpa nominal, tanpa baris tersimpan', async () => {
    const r1 = await a.setBudgetAction('pribadi', {
      categoryId: fx.ids.tagihanCat,
      month: '2026-11',
      amount: 1_234_567,
      wajib: true,
    });
    expect(r1).toEqual({ ok: false, error: { code: 'obligation_double' } });
    expect(memuatNominal(r1, 1_234_567)).toBe(false);
    const r2 = await a.createBillAction('pribadi', {
      clientId: randomUUID(),
      name: 'Asuransi',
      amount: 765_432,
      categoryId: fx.ids.kesehatan,
      dayOfMonth: 15,
      startsOn: '2026-11-01',
    });
    expect(r2).toEqual({ ok: false, error: { code: 'obligation_double' } });
    const { rows } = await h.admin.query<{ n: number }>(
      `select ((select count(*) from app.bills where name = 'Asuransi')
              + (select count(*) from app.budgets where category_id = $1))::int as n`,
      [fx.ids.tagihanCat],
    );
    expect(rows[0]?.n).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('payBillAction clientId sama dua kali = satu entri; bayar ulang = already_posted', async () => {
    const occ = await firstOccurrence('pribadi');
    const clientId = randomUUID();
    const first = await a.payBillAction('pribadi', { clientId, occurrenceId: occ });
    const second = await a.payBillAction('pribadi', { clientId, occurrenceId: occ });
    if (!first.ok || !second.ok) throw new Error('bayar gagal');
    expect(second.value).toMatchObject({ entryId: first.value.entryId, replayed: true });
    const { rows } = await h.admin.query<{ n: number }>(
      `select count(*)::int as n from app.entries where description = $1`,
      [KANARI.nTagihan],
    );
    expect(rows[0]?.n).toBe(1);
    expect(await a.payBillAction('pribadi', { clientId: randomUUID(), occurrenceId: occ })).toEqual(
      { ok: false, error: { code: 'already_posted' } },
    );
    expect(await a.skipBillAction('pribadi', occ)).toEqual({
      ok: false,
      error: { code: 'already_posted' },
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('ruang lain: kemunculan Pribadi dari rute Bersama, Luar, dan F = not_found', async () => {
    const occ = await firstOccurrence('pribadi');
    const nf = { ok: false, error: { code: 'not_found' } };
    expect(await a.payBillAction('bersama', { clientId: randomUUID(), occurrenceId: occ })).toEqual(
      nf,
    );
    expect(await a.archiveBillAction('bersama', fx.ids.bill)).toEqual(nf);
    expect(
      await a.updateBillAction('bersama', {
        billId: fx.ids.bill,
        name: 'Ubah dari Bersama',
        amount: 1_000,
        categoryId: fx.ids.tagihanCat,
        dayOfMonth: 10,
        endsOn: null,
        accountId: null,
      }),
    ).toEqual(nf);
    expect(await a.skipBillAction('bersama', occ)).toEqual(nf);
    session.userId = fx.f.id;
    expect(await a.payBillAction('bersama', { clientId: randomUUID(), occurrenceId: occ })).toEqual(
      nf,
    );
    // F membayar tagihan Bersama dari dompet Pribadinya: ditolak (dompet bukan ruang ini).
    session.userId = fx.n.id;
    const created = await a.createBillAction('bersama', {
      clientId: randomUUID(),
      name: 'Internet',
      amount: 350_000,
      categoryId: await categoryNamed(
        h,
        (await ctxAt(clock.at(TODAY), fx.n, 'bersama')).spaceId,
        'Internet',
      ),
      dayOfMonth: 8,
      startsOn: '2026-11-01',
    });
    expect(created.ok).toBe(true);
    const shared = await firstOccurrence('bersama');
    session.userId = fx.f.id;
    const { rows } = await h.admin.query<{ id: string }>(
      `select a.id from app.accounts a join app.spaces s on s.id = a.space_id
        where s.kind = 'personal' and s.owner_user_id = $1 limit 1`,
      [fx.f.id],
    );
    expect(
      await a.payBillAction('bersama', {
        clientId: randomUUID(),
        occurrenceId: shared,
        accountId: rows[0]?.id,
      }),
    ).toEqual(nf);
    // Dari dompet Bersama: boleh.
    expect(
      await a.payBillAction('bersama', {
        clientId: randomUUID(),
        occurrenceId: shared,
        accountId: fx.ids.kas,
      }),
    ).toMatchObject({ ok: true });
    session.userId = fx.luar.id;
    expect(await a.copyBudgetsAction('pribadi', { toMonth: '2026-12' })).toEqual(nf);
  });

  it('copyBudgetsAction (K13): salin lalu idempoten; rincian tanpa anggaran induk = parent_budget_required', async () => {
    expect(await a.copyBudgetsAction('pribadi', { toMonth: '2026-12' })).toEqual({
      ok: true,
      value: { copied: 3, skippedExisting: 0, skippedConflict: 0, skippedArchived: 0 },
    });
    expect(await a.copyBudgetsAction('pribadi', { toMonth: '2026-12' })).toEqual({
      ok: true,
      value: { copied: 0, skippedExisting: 3, skippedConflict: 0, skippedArchived: 0 },
    });
    const bersama = (await ctxAt(clock.at(TODAY), fx.n, 'bersama')).spaceId;
    expect(
      await a.setBudgetAction('bersama', {
        categoryId: await categoryNamed(h, bersama, 'Sayur & Buah'),
        month: '2026-11',
        amount: 100_000,
        wajib: false,
      }),
    ).toEqual({ ok: false, error: { code: 'parent_budget_required' } });
    expect(
      await a.deleteBudgetAction('pribadi', { categoryId: fx.ids.makan, month: '2026-12' }),
    ).toEqual({ ok: true, value: undefined });
  });

  it('ubah dan arsip tagihan; tagihan terarsip = bill_archived; dompet Kantor = bill_account_kantor', async () => {
    const { rows } = await h.admin.query<{ id: string }>(
      `select id from app.accounts where name = 'Kas Kantor'`,
    );
    const kantor = rows[0]?.id;
    const base = {
      billId: fx.ids.bill,
      name: KANARI.nTagihan,
      amount: 500_000,
      categoryId: fx.ids.tagihanCat,
      dayOfMonth: 10,
      endsOn: null,
    };
    expect(await a.updateBillAction('pribadi', { ...base, accountId: kantor ?? null })).toEqual({
      ok: false,
      error: { code: 'bill_account_kantor' },
    });
    expect(await a.updateBillAction('pribadi', { ...base, accountId: fx.ids.bca })).toMatchObject({
      ok: true,
    });
    expect(await a.archiveBillAction('pribadi', fx.ids.bill)).toMatchObject({ ok: true });
    expect(await a.updateBillAction('pribadi', { ...base, accountId: fx.ids.bca })).toEqual({
      ok: false,
      error: { code: 'bill_archived' },
    });
  });
});
