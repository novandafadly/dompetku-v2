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
 * Action S7 terhadap Postgres (pola `actions.int.test.ts`): transfer antar ruang, pindah ruang,
 * cocokkan saldo, arsip dompet, talangan + reimburse. Fokus: ruang tujuan di-resolve server dari
 * slug, dan hasil action yang bisa sampai ke rute Bersama tidak memuat id entri Pribadi.
 */

const session = vi.hoisted(() => ({ userId: '', pools: null as Pools | null }));
const refresh = vi.hoisted(() => vi.fn());

vi.mock('next/cache', () => ({ refresh, revalidatePath: vi.fn() }));
vi.mock('@/server/auth/next', () => ({
  requireDataUser: () => Promise.resolve({ userId: session.userId }),
  authService: () => ({ pools: session.pools }),
}));

const { saveCatat, catatOptions } = await import('../catat');
const { createAccountAction, reconcileAction, archiveAccountAction } = await import('../dompet');
const { voidEntryAction, restoreEntryAction, moveEntryAction, moveTargetsAction } =
  await import('../entri');
const { createReimbursementAction, openReimbursablesAction } = await import('../reimburse');

const h = createLedgerHarness();
session.pools = h.pools;

afterAll(async () => {
  await h.close();
});

type Ruang = 'pribadi' | 'bersama';

function must(p: Persona | null): Persona {
  if (!p) throw new Error('persona tidak ada');
  return p;
}

function as(p: Persona): void {
  session.userId = p.id;
}

async function wallet(
  ruang: Ruang,
  openingBalance: number,
  name: string,
  pocket: 'operasional' | 'tabungan' | 'kantor' = 'operasional',
): Promise<string> {
  const r = await createAccountAction(ruang, {
    clientId: randomUUID(),
    name,
    pocket,
    walletType: 'bank',
    openingBalance,
  });
  if (!r.ok) throw new Error(`dompet gagal: ${r.error.code}`);
  return r.value.accountId;
}

async function category(ruang: Ruang, type: 'income' | 'expense' = 'expense'): Promise<string> {
  const r = await catatOptions(ruang);
  if (!r.ok) throw new Error(`opsi gagal: ${r.error.code}`);
  const c = r.value.categories.find((x) => x.type === type && x.parentId === null);
  if (!c) throw new Error('kategori tidak ada');
  return c.id;
}

async function expense(ruang: Ruang, accountId: string, amount: number, description?: string) {
  const r = await saveCatat(ruang, {
    kind: 'expense',
    clientId: randomUUID(),
    accountId,
    amount,
    categoryId: await category(ruang),
    ...(description === undefined ? {} : { description }),
  });
  if (!r.ok) throw new Error(`simpan gagal: ${r.error.code}`);
  return r.value;
}

interface EntryRow {
  id: string;
  space_id: string;
  description: string | null;
  shared_note: string | null;
  voided: boolean;
}

async function entriesOf(kind: string): Promise<EntryRow[]> {
  const { rows } = await h.admin.query<EntryRow>(
    `select id::text, space_id::text, description, shared_note, voided_at is not null as voided
       from app.entries where kind = $1::app.entry_kind order by created_at, id`,
    [kind],
  );
  return rows;
}

describe('action S7 terhadap DB', () => {
  let ps: Personas;
  let f: Persona;
  let fPribadi: string;
  let bersama: string;

  beforeEach(async () => {
    await resetLedger(h);
    ps = await seedPersonas(h, { farida: 'bergabung' });
    f = must(ps.f);
    fPribadi = await spaceIdOf(h, f.id, 'personal');
    bersama = await spaceIdOf(h, ps.n.id, 'shared');
    refresh.mockClear();
  });

  describe('transfer antar ruang (saveCatat space_transfer)', () => {
    it('F dari /bersama ke Pribadi: keterangan hanya di kaki Pribadi F, kaki Bersama hanya shared_note; hasil tanpa id kaki Pribadi', async () => {
      as(ps.n);
      const kas = await wallet('bersama', 1_000_000, 'Kas Rumah');
      as(f);
      const fBca = await wallet('pribadi', 0, 'BCA F');
      const r = await saveCatat('bersama', {
        kind: 'space_transfer',
        clientId: randomUUID(),
        fromAccountId: kas,
        toRuang: 'pribadi',
        toAccountId: fBca,
        amount: 150_000,
        description: 'ganti bensin pribadi',
        sharedNote: 'Ambil untuk bensin',
      });
      expect(r).toMatchObject({ ok: true, value: { version: 1, replayed: false } });
      if (!r.ok) throw new Error(r.error.code);
      expect(Object.keys(r.value).sort()).toEqual(['entryId', 'replayed', 'version']);

      const legs = await entriesOf('space_transfer');
      expect(legs).toHaveLength(2);
      const pribadiLeg = legs.find((l) => l.space_id === fPribadi);
      const bersamaLeg = legs.find((l) => l.space_id === bersama);
      expect(pribadiLeg).toMatchObject({
        description: 'ganti bensin pribadi',
        shared_note: null,
      });
      expect(bersamaLeg).toMatchObject({ description: null, shared_note: 'Ambil untuk bensin' });
      // Hasil action dari /bersama = kaki Bersama saja.
      expect(r.value.entryId).toBe(bersamaLeg?.id);
      expect(JSON.stringify(r)).not.toContain(pribadiLeg?.id ?? '-');
    });

    it('Batalkan/Pulihkan berpasangan hanya oleh pencatat; hasil hanya versi', async () => {
      as(ps.n);
      const bca = await wallet('pribadi', 500_000, 'BCA');
      const kas = await wallet('bersama', 0, 'Kas Rumah');
      const saved = await saveCatat('pribadi', {
        kind: 'space_transfer',
        clientId: randomUUID(),
        fromAccountId: bca,
        toRuang: 'bersama',
        toAccountId: kas,
        amount: 200_000,
        description: 'bayar kos adik',
      });
      if (!saved.ok) throw new Error(saved.error.code);
      const bersamaLeg = (await entriesOf('space_transfer')).find((l) => l.space_id === bersama);
      if (!bersamaLeg) throw new Error('kaki Bersama tidak ada');

      // F (bukan pencatat) dari /bersama: DB menyamakan dengan tidak ditemukan (DK404, BSD §9.1
      // security A1), bukan `not_creator` seperti Pindahkan.
      as(f);
      await expect(
        voidEntryAction('bersama', {
          clientId: randomUUID(),
          entryId: bersamaLeg.id,
          expectedVersion: 1,
        }),
      ).resolves.toEqual({ ok: false, error: { code: 'not_found' } });
      expect((await entriesOf('space_transfer')).map((l) => l.voided)).toEqual([false, false]);

      // N membatalkan dari /bersama lewat kaki Bersama: kedua kaki batal.
      as(ps.n);
      await expect(
        voidEntryAction('bersama', {
          clientId: randomUUID(),
          entryId: bersamaLeg.id,
          expectedVersion: 1,
        }),
      ).resolves.toEqual({ ok: true, value: { version: 2 } });
      expect((await entriesOf('space_transfer')).map((l) => l.voided)).toEqual([true, true]);

      // Pulihkan dari /pribadi lewat kaki Pribadi: kedua kaki hidup lagi.
      await expect(
        restoreEntryAction('pribadi', {
          clientId: randomUUID(),
          entryId: saved.value.entryId,
          expectedVersion: 2,
        }),
      ).resolves.toEqual({ ok: true, value: { version: 3 } });
      expect((await entriesOf('space_transfer')).map((l) => l.voided)).toEqual([false, false]);
    });

    it('ruang tujuan sama dengan ruang asal = invalid toRuang, tanpa entri', async () => {
      as(ps.n);
      const a = await wallet('pribadi', 100_000, 'BCA');
      const b = await wallet('pribadi', 0, 'Tunai');
      await expect(
        saveCatat('pribadi', {
          kind: 'space_transfer',
          clientId: randomUUID(),
          fromAccountId: a,
          toRuang: 'pribadi',
          toAccountId: b,
          amount: 1_000,
        }),
      ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'toRuang' } });
      expect(await entriesOf('space_transfer')).toEqual([]);
    });
  });

  describe('pindahkan ke ruang lain', () => {
    it('Pribadi → Bersama tanpa keepDescription: keterangan tidak ikut; hasil id entri Bersama', async () => {
      as(ps.n);
      const bca = await wallet('pribadi', 500_000, 'BCA');
      const kas = await wallet('bersama', 500_000, 'Kas Rumah');
      const src = await expense('pribadi', bca, 40_000, 'obat flu');
      const r = await moveEntryAction('pribadi', {
        clientId: randomUUID(),
        entryId: src.entryId,
        expectedVersion: src.version,
        toRuang: 'bersama',
        accountId: kas,
        categoryId: await category('bersama'),
      });
      expect(r).toMatchObject({ ok: true, value: { toRuang: 'bersama', replayed: false } });
      if (!r.ok || r.value.toRuang !== 'bersama') throw new Error('pindah gagal');
      const newId = r.value.entryId;
      const rows = await entriesOf('expense');
      const moved = rows.find((x) => x.id === newId);
      expect(moved).toMatchObject({ space_id: bersama, description: null, voided: false });
      expect(rows.find((x) => x.id === src.entryId)).toMatchObject({ voided: true });
    });

    it('Pribadi → Bersama dengan keepDescription: keterangan ikut', async () => {
      as(ps.n);
      const bca = await wallet('pribadi', 500_000, 'BCA');
      const kas = await wallet('bersama', 500_000, 'Kas Rumah');
      const src = await expense('pribadi', bca, 40_000, 'galon');
      const r = await moveEntryAction('pribadi', {
        clientId: randomUUID(),
        entryId: src.entryId,
        expectedVersion: src.version,
        toRuang: 'bersama',
        accountId: kas,
        categoryId: await category('bersama'),
        keepDescription: true,
      });
      if (!r.ok || r.value.toRuang !== 'bersama') throw new Error('pindah gagal');
      const newId = r.value.entryId;
      expect((await entriesOf('expense')).find((x) => x.id === newId)).toMatchObject({
        space_id: bersama,
        description: 'galon',
      });
    });

    it('F dari /bersama ke Pribadi: keterangan ikut; hasil tanpa id entri Pribadi', async () => {
      as(ps.n);
      const kas = await wallet('bersama', 500_000, 'Kas Rumah');
      as(f);
      const fBca = await wallet('pribadi', 500_000, 'BCA F');
      const src = await expense('bersama', kas, 25_000, 'jajan');
      const targets = await moveTargetsAction('bersama', 'pribadi');
      if (!targets.ok) throw new Error(targets.error.code);
      expect(targets.value.accounts.map((a) => a.id)).toEqual([fBca]);
      const r = await moveEntryAction('bersama', {
        clientId: randomUUID(),
        entryId: src.entryId,
        expectedVersion: src.version,
        toRuang: 'pribadi',
        accountId: fBca,
        categoryId: await category('pribadi'),
      });
      expect(r).toEqual({ ok: true, value: { toRuang: 'pribadi', replayed: false } });
      const moved = (await entriesOf('expense')).find((x) => x.space_id === fPribadi);
      expect(moved).toMatchObject({ description: 'jajan', voided: false });
      expect(JSON.stringify(r)).not.toContain(moved?.id ?? '-');
    });

    it('bukan pencatat = not_creator, entri tetap', async () => {
      as(ps.n);
      const kas = await wallet('bersama', 500_000, 'Kas Rumah');
      const bca = await wallet('pribadi', 0, 'BCA');
      as(f);
      const src = await expense('bersama', kas, 10_000);
      as(ps.n);
      await expect(
        moveEntryAction('bersama', {
          clientId: randomUUID(),
          entryId: src.entryId,
          expectedVersion: src.version,
          toRuang: 'pribadi',
          accountId: bca,
          categoryId: await category('pribadi'),
        }),
      ).resolves.toEqual({ ok: false, error: { code: 'not_creator' } });
      expect(await entriesOf('expense')).toEqual([
        expect.objectContaining({ id: src.entryId, voided: false }),
      ]);
    });

    it('moveTargetsAction: dompet aktif non-kantor dan kategori aktif ruang tujuan saja', async () => {
      as(ps.n);
      const bca = await wallet('pribadi', 0, 'BCA');
      await wallet('pribadi', 0, 'Kartu Kantor', 'kantor');
      const kas = await wallet('bersama', 0, 'Kas Rumah');
      const lama = await wallet('bersama', 0, 'Kas Lama');
      expect(await archiveAccountAction('bersama', lama)).toEqual({
        ok: true,
        value: { archived: true },
      });
      const r = await moveTargetsAction('pribadi', 'bersama');
      if (!r.ok) throw new Error(r.error.code);
      expect(r.value.accounts.map((a) => a.id)).toEqual([kas]);
      expect(r.value.categories.length).toBeGreaterThan(0);
      expect(r.value.categories.every((c) => !c.archived)).toBe(true);
      const back = await moveTargetsAction('bersama', 'pribadi');
      if (!back.ok) throw new Error(back.error.code);
      expect(back.value.accounts.map((a) => a.id)).toEqual([bca]);
    });
  });

  describe('dompet: cocokkan saldo dan arsip', () => {
    it('reconcileAction: selisih bertanda; selisih 0 = tanpa entri', async () => {
      as(ps.n);
      const bca = await wallet('pribadi', 100_000, 'BCA');
      const r = await reconcileAction('pribadi', {
        clientId: randomUUID(),
        accountId: bca,
        actualBalance: 90_000,
      });
      expect(r).toMatchObject({ ok: true, value: { difference: -10_000, replayed: false } });
      await expect(
        reconcileAction('pribadi', {
          clientId: randomUUID(),
          accountId: bca,
          actualBalance: 90_000,
        }),
      ).resolves.toEqual({ ok: true, value: { entryId: null, difference: 0, replayed: false } });
      // Dompet Pribadi dari rute Bersama = not_found.
      await expect(
        reconcileAction('bersama', { clientId: randomUUID(), accountId: bca, actualBalance: 0 }),
      ).resolves.toEqual({ ok: false, error: { code: 'not_found' } });
    });

    it('archiveAccountAction: saldo 0 diarsip; saldo ≠ 0 = balance_not_zero', async () => {
      as(ps.n);
      const kosong = await wallet('pribadi', 0, 'Kosong');
      const isi = await wallet('pribadi', 5_000, 'Isi');
      await expect(archiveAccountAction('pribadi', kosong)).resolves.toEqual({
        ok: true,
        value: { archived: true },
      });
      await expect(archiveAccountAction('pribadi', isi)).resolves.toEqual({
        ok: false,
        error: { code: 'balance_not_zero' },
      });
    });
  });

  describe('talangan dan reimburse', () => {
    it('talangan Pribadi → reimburse sebagian → melebihi sisa ditolak; Bersama kosong', async () => {
      as(ps.n);
      const bca = await wallet('pribadi', 1_000_000, 'BCA');
      const saved = await saveCatat('pribadi', {
        kind: 'expense',
        clientId: randomUUID(),
        accountId: bca,
        amount: 500_000,
        categoryId: await category('pribadi'),
        reimbursable: true,
      });
      if (!saved.ok) throw new Error(saved.error.code);

      const open = await openReimbursablesAction('pribadi');
      expect(open).toMatchObject({
        ok: true,
        value: [{ entryId: saved.value.entryId, remaining: 500_000, reimbursed: 0 }],
      });

      const first = await createReimbursementAction('pribadi', {
        clientId: randomUUID(),
        entryId: saved.value.entryId,
        accountId: bca,
        amount: 300_000,
      });
      expect(first).toMatchObject({ ok: true, value: { remaining: 200_000, replayed: false } });
      await expect(
        createReimbursementAction('pribadi', {
          clientId: randomUUID(),
          entryId: saved.value.entryId,
          accountId: bca,
          amount: 300_000,
        }),
      ).resolves.toEqual({ ok: false, error: { code: 'reimbursement_exceeds' } });

      await expect(openReimbursablesAction('bersama')).resolves.toEqual({ ok: true, value: [] });
    });

    it('talangan di Bersama = invalid reimbursable, tanpa entri', async () => {
      as(ps.n);
      const kas = await wallet('bersama', 100_000, 'Kas Rumah');
      await expect(
        saveCatat('bersama', {
          kind: 'expense',
          clientId: randomUUID(),
          accountId: kas,
          amount: 10_000,
          categoryId: await category('bersama'),
          reimbursable: true,
        }),
      ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'reimbursable' } });
      expect(await entriesOf('expense')).toEqual([]);
    });
  });
});
