import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { withUser } from '../../db';
import { toLedgerError } from '../errors';
import { recordProductEvent } from '../events';
import {
  archiveCategory,
  createAccount,
  createCategory,
  createEntry,
  createTransfer,
  markNoSpendDay,
  restoreEntry,
  updateCategory,
  updateEntry,
  voidEntry,
  type LedgerCtx,
} from '../write';
import {
  createLedgerHarness,
  resetLedger,
  seedPersonas,
  spaceIdOf,
  type Persona,
  type Personas,
} from './harness';

const h = createLedgerHarness();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterAll(async () => {
  await h.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function must(p: Persona | null): Persona {
  if (!p) throw new Error('persona tidak ada');
  return p;
}

/** Galat yang dilempar wrapper (mentah dari DB/Zod); pemetaan UI lewat `toLedgerError`. */
async function failure(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('seharusnya gagal');
    },
    (e: unknown) => e,
  );
}

async function ledgerCode(p: Promise<unknown>) {
  return toLedgerError(await failure(p));
}

/** Saldo dari baris jurnal yang tidak batal (dibaca superuser, pembanding independen). */
async function balance(accountId: string): Promise<number> {
  const { rows } = await h.admin.query<{ b: number }>(
    `select coalesce(sum(l.amount), 0)::int as b
       from app.entry_lines l join app.entries e on e.id = l.entry_id
      where l.account_id = $1 and e.voided_at is null`,
    [accountId],
  );
  return rows[0]?.b ?? NaN;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await h.admin.query<{ n: number }>(
    `select count(*)::int as n from ${sql}`,
    params,
  );
  return rows[0]?.n ?? NaN;
}

/** Kategori awal ruang (lahir dari trigger seed saat anggota masuk). */
async function categoryOf(spaceId: string, type: 'income' | 'expense'): Promise<string> {
  const { rows } = await h.admin.query<{ id: string }>(
    `select id from app.categories
      where space_id = $1 and type = $2 and parent_id is null and archived_at is null
      order by sort_order limit 1`,
    [spaceId, type],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('kategori awal tidak ada');
  return id;
}

async function wallet(ctx: LedgerCtx, openingBalance: number, name = 'BCA'): Promise<string> {
  const { accountId } = await createAccount(ctx, {
    clientId: randomUUID(),
    name,
    pocket: 'operasional',
    walletType: 'bank',
    openingBalance,
  });
  return accountId;
}

describe('wrapper tulis api.* (N dan F bergabung)', () => {
  let ps: Personas;
  let nPribadi: LedgerCtx;
  let nBersama: LedgerCtx;
  let fPribadi: LedgerCtx;

  beforeEach(async () => {
    await resetLedger(h);
    ps = await seedPersonas(h, { farida: 'bergabung' });
    const f = must(ps.f);
    nPribadi = {
      pools: h.pools,
      userId: ps.n.id,
      spaceId: await spaceIdOf(h, ps.n.id, 'personal'),
    };
    nBersama = { pools: h.pools, userId: ps.n.id, spaceId: await spaceIdOf(h, ps.n.id, 'shared') };
    fPribadi = { pools: h.pools, userId: f.id, spaceId: await spaceIdOf(h, f.id, 'personal') };
  });

  describe('idempotensi (Review Focus 1)', () => {
    it('idempotensi: clientId sama dua kali = satu entri', async () => {
      const acc = await wallet(nPribadi, 500_000);
      const input = {
        clientId: randomUUID(),
        accountId: acc,
        kind: 'expense' as const,
        amount: 35_000,
        categoryId: await categoryOf(nPribadi.spaceId, 'expense'),
        description: 'makan siang',
      };

      const first = await createEntry(nPribadi, input);
      const second = await createEntry(nPribadi, input);

      expect(first.entryId).toMatch(UUID);
      expect(first).toEqual({ entryId: first.entryId, version: 1, replayed: false, warnings: [] });
      expect(second).toEqual({ ...first, replayed: true });
      expect(await count(`app.entries where kind = 'expense'`)).toBe(1);
      expect(await balance(acc)).toBe(465_000);
    });

    it('idempotensi: dua panggilan serentak clientId sama (klik ganda) = satu entri', async () => {
      const acc = await wallet(nPribadi, 500_000);
      const input = {
        clientId: randomUUID(),
        accountId: acc,
        kind: 'expense' as const,
        amount: 12_000,
        categoryId: await categoryOf(nPribadi.spaceId, 'expense'),
      };

      const [a, b] = await Promise.all([
        createEntry(nPribadi, input),
        createEntry(nPribadi, input),
      ]);

      expect(a.entryId).toBe(b.entryId);
      expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
      expect(await count(`app.entries where kind = 'expense'`)).toBe(1);
      expect(await balance(acc)).toBe(488_000);
    });

    it('clientId sama isi beda = idem_mismatch', async () => {
      const acc = await wallet(nPribadi, 500_000);
      const input = {
        clientId: randomUUID(),
        accountId: acc,
        kind: 'expense' as const,
        amount: 35_000,
        categoryId: await categoryOf(nPribadi.spaceId, 'expense'),
      };
      await createEntry(nPribadi, input);

      const err = await failure(createEntry(nPribadi, { ...input, amount: 36_000 }));

      expect(toLedgerError(err)).toEqual({ code: 'idem_mismatch' });
      // Pesan galat tidak membawa nominal.
      expect((err as Error).message).not.toContain('36');
      expect(await count(`app.entries where kind = 'expense'`)).toBe(1);
      expect(await balance(acc)).toBe(465_000);
    });
  });

  describe('saldo', () => {
    it('saldo kurang tanpa allowNegative = saldo_negatif, tanpa baris baru', async () => {
      const acc = await wallet(nPribadi, 50_000);
      const input = {
        clientId: randomUUID(),
        accountId: acc,
        kind: 'expense' as const,
        amount: 80_000,
        categoryId: await categoryOf(nPribadi.spaceId, 'expense'),
      };
      const before = await count('app.entries');

      expect(await ledgerCode(createEntry(nPribadi, input))).toEqual({ code: 'saldo_negatif' });
      expect(await count('app.entries')).toBe(before);
      expect(await balance(acc)).toBe(50_000);

      // "Simpan tetap" = clientId sama, allowNegative (di luar hash idempotensi).
      const saved = await createEntry(nPribadi, { ...input, allowNegative: true });
      expect(saved.replayed).toBe(false);
      expect(await count('app.entries')).toBe(before + 1);
      expect(await balance(acc)).toBe(-30_000);
    });
  });

  describe('versi dan batal (Review Focus 2)', () => {
    it('updateEntry versi usang = conflict', async () => {
      const acc = await wallet(nPribadi, 500_000);
      const categoryId = await categoryOf(nPribadi.spaceId, 'expense');
      const { entryId } = await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: acc,
        kind: 'expense',
        amount: 35_000,
        categoryId,
      });
      const edit = {
        entryId,
        accountId: acc,
        categoryId,
        occurredOn: null,
        description: 'tab pertama',
        reimbursable: false,
      };

      // Tab pertama menyimpan v1 → v2.
      await expect(
        updateEntry(nPribadi, {
          ...edit,
          clientId: randomUUID(),
          expectedVersion: 1,
          amount: 40_000,
        }),
      ).resolves.toEqual({ entryId, version: 2 });

      // Tab kedua masih memegang v1: ditolak, tidak menimpa diam-diam.
      expect(
        await ledgerCode(
          updateEntry(nPribadi, {
            ...edit,
            clientId: randomUUID(),
            expectedVersion: 1,
            amount: 99_000,
            description: 'tab kedua',
          }),
        ),
      ).toEqual({ code: 'conflict' });
      const { rows } = await h.admin.query<{ version: number; description: string }>(
        'select version, description from app.entries where id = $1',
        [entryId],
      );
      expect(rows[0]).toEqual({ version: 2, description: 'tab pertama' });
      expect(await balance(acc)).toBe(460_000);

      // "Timpa dengan perubahan saya" mengirim versi terbaru.
      await expect(
        updateEntry(nPribadi, {
          ...edit,
          clientId: randomUUID(),
          expectedVersion: 2,
          amount: 99_000,
        }),
      ).resolves.toEqual({ entryId, version: 3 });
      expect(await balance(acc)).toBe(401_000);
    });

    it('voidEntry lalu restoreEntry mengembalikan saldo awal', async () => {
      const acc = await wallet(nPribadi, 100_000);
      const { entryId } = await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: acc,
        kind: 'expense',
        amount: 30_000,
        categoryId: await categoryOf(nPribadi.spaceId, 'expense'),
      });
      expect(await balance(acc)).toBe(70_000);

      // Urungkan (toast) = void: saldo kembali ke saldo awal.
      const voidInput = { clientId: randomUUID(), entryId, expectedVersion: 1 };
      await expect(voidEntry(nPribadi, voidInput)).resolves.toEqual({ version: 2 });
      expect(await balance(acc)).toBe(100_000);
      // Void diulang (koneksi putus) = jawaban sama, tanpa galat already_voided.
      await expect(voidEntry(nPribadi, voidInput)).resolves.toEqual({ version: 2 });

      await expect(
        restoreEntry(nPribadi, { clientId: randomUUID(), entryId, expectedVersion: 2 }),
      ).resolves.toEqual({ version: 3 });
      expect(await balance(acc)).toBe(70_000);
    });

    it('restore sesudah 90 hari = restore_window_closed', async () => {
      const acc = await wallet(nPribadi, 100_000);
      const categoryId = await categoryOf(nPribadi.spaceId, 'expense');
      const mk = async () => {
        const { entryId } = await createEntry(nPribadi, {
          clientId: randomUUID(),
          accountId: acc,
          kind: 'expense',
          amount: 10_000,
          categoryId,
        });
        await voidEntry(nPribadi, { clientId: randomUUID(), entryId, expectedVersion: 1 });
        return entryId;
      };
      const lama = await mk();
      const baru = await mk();
      // api.restore_entry membandingkan voided_at dengan app.now() - 90 hari; tests.clock tidak
      // tersedia di web, jadi voided_at dimundurkan lewat superuser.
      await h.admin.query(
        `update app.entries set voided_at = now() - interval '90 days 1 minute' where id = $1`,
        [lama],
      );
      await h.admin.query(
        `update app.entries set voided_at = now() - interval '89 days 23 hours' where id = $1`,
        [baru],
      );

      expect(
        await ledgerCode(
          restoreEntry(nPribadi, { clientId: randomUUID(), entryId: lama, expectedVersion: 2 }),
        ),
      ).toEqual({ code: 'restore_window_closed' });
      await expect(
        restoreEntry(nPribadi, { clientId: randomUUID(), entryId: baru, expectedVersion: 2 }),
      ).resolves.toEqual({ version: 3 });
      expect(await balance(acc)).toBe(90_000);
    });
  });

  describe('ruang eksplisit', () => {
    it('ruang Bersama tidak menerima dompet Pribadi', async () => {
      const nAcc = await wallet(nPribadi, 100_000, 'BCA N');
      const fAcc = await wallet(fPribadi, 100_000, 'BCA F');
      const shared = await wallet(nBersama, 100_000, 'Kas Rumah');
      const categoryId = await categoryOf(nBersama.spaceId, 'expense');
      const before = await count('app.entries');
      const entry = (accountId: string) =>
        createEntry(nBersama, {
          clientId: randomUUID(),
          accountId,
          kind: 'expense',
          amount: 10_000,
          categoryId,
        });

      // Dompet Pribadi N sendiri (N anggota ruangnya) dan dompet Pribadi F (QA B2).
      expect(await ledgerCode(entry(nAcc))).toEqual({ code: 'not_found' });
      expect(await ledgerCode(entry(fAcc))).toEqual({ code: 'not_found' });
      // Transfer di S6 hanya satu ruang: Bersama → Pribadi ditolak.
      expect(
        await ledgerCode(
          createTransfer(nBersama, {
            clientId: randomUUID(),
            fromAccountId: shared,
            toAccountId: nAcc,
            amount: 10_000,
          }),
        ),
      ).toEqual({ code: 'not_found' });
      expect(await count('app.entries')).toBe(before);
      expect(await balance(nAcc)).toBe(100_000);
      expect(await balance(shared)).toBe(100_000);

      // Entri Pribadi tidak bisa diubah/dibatalkan dari konteks Bersama.
      const { entryId } = await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: nAcc,
        kind: 'expense',
        amount: 5_000,
        categoryId: await categoryOf(nPribadi.spaceId, 'expense'),
      });
      expect(
        await ledgerCode(
          voidEntry(nBersama, { clientId: randomUUID(), entryId, expectedVersion: 1 }),
        ),
      ).toEqual({ code: 'not_found' });
      expect(
        await ledgerCode(
          updateEntry(nBersama, {
            clientId: randomUUID(),
            entryId,
            expectedVersion: 1,
            accountId: shared,
            amount: 5_000,
            categoryId: null,
            occurredOn: null,
            description: null,
            reimbursable: false,
          }),
        ),
      ).toEqual({ code: 'not_found' });
      const { rows } = await h.admin.query<{ version: number }>(
        'select version from app.entries where id = $1',
        [entryId],
      );
      expect(rows[0]?.version).toBe(1);

      // Kategori Pribadi tidak bisa diubah/diarsipkan dari konteks Bersama.
      const pribadiCat = await categoryOf(nPribadi.spaceId, 'expense');
      expect(
        await ledgerCode(
          updateCategory(nBersama, {
            categoryId: pribadiCat,
            name: 'X',
            icon: 'Coffee',
            parentId: null,
          }),
        ),
      ).toEqual({ code: 'not_found' });
      expect(await ledgerCode(archiveCategory(nBersama, { categoryId: pribadiCat }))).toEqual({
        code: 'not_found',
      });
    });

    it('bukan anggota ruang = not_found (Pribadi pasangan)', async () => {
      const ctx: LedgerCtx = { ...nPribadi, spaceId: fPribadi.spaceId };
      expect(await ledgerCode(markNoSpendDay(ctx))).toEqual({ code: 'not_found' });
      expect(await count('app.no_spend_days')).toBe(0);
    });
  });

  describe('fungsi tulis lain', () => {
    it('createTransfer satu ruang memindahkan saldo; diulang = replayed', async () => {
      const a = await wallet(nBersama, 100_000, 'Kas');
      const b = await wallet(nBersama, 0, 'Tabungan');
      const input = { clientId: randomUUID(), fromAccountId: a, toAccountId: b, amount: 40_000 };

      const first = await createTransfer(nBersama, input);
      expect(first.entryId).toMatch(UUID);
      expect(first).toEqual({ entryId: first.entryId, version: 1, replayed: false });
      await expect(createTransfer(nBersama, input)).resolves.toEqual({ ...first, replayed: true });
      expect([await balance(a), await balance(b)]).toEqual([60_000, 40_000]);
    });

    it('createAccount dengan saldo awal 0 dan > 0', async () => {
      const kosong = await wallet(nPribadi, 0, 'Dompet');
      const isi = await wallet(nPribadi, 250_000, 'GoPay');
      expect([await balance(kosong), await balance(isi)]).toEqual([0, 250_000]);
      expect(await count(`app.accounts where space_id = $1`, [nPribadi.spaceId])).toBe(2);
    });

    it('kategori: buat (idempoten), ubah, arsip (anak ikut), arsip kedua = 0', async () => {
      const input = {
        clientId: randomUUID(),
        type: 'expense' as const,
        name: '  Parkir  ',
        icon: 'Car',
      };
      const { categoryId: induk } = await createCategory(nPribadi, input);
      await expect(createCategory(nPribadi, input)).resolves.toEqual({ categoryId: induk });
      const { categoryId: anak } = await createCategory(nPribadi, {
        clientId: randomUUID(),
        type: 'expense',
        name: 'Parkir Kantor',
        icon: 'Car',
        parentId: induk,
      });

      await expect(
        updateCategory(nPribadi, {
          categoryId: induk,
          name: 'Parkir & Tol',
          icon: 'Road',
          parentId: null,
        }),
      ).resolves.toBeUndefined();
      const { rows } = await h.admin.query<{ name: string; icon: string }>(
        'select name, icon from app.categories where id = $1',
        [induk],
      );
      expect(rows[0]).toEqual({ name: 'Parkir & Tol', icon: 'Road' });

      await expect(archiveCategory(nPribadi, { categoryId: induk })).resolves.toEqual({
        affected: 2,
      });
      await expect(archiveCategory(nPribadi, { categoryId: induk })).resolves.toEqual({
        affected: 0,
      });
      expect(
        await count('app.categories where id = any($1) and archived_at is not null', [
          [induk, anak],
        ]),
      ).toBe(2);
    });

    it('markNoSpendDay: hari WIB server, dua kali = satu baris', async () => {
      await expect(markNoSpendDay(nBersama)).resolves.toEqual({ created: true });
      await expect(markNoSpendDay(nBersama)).resolves.toEqual({ created: false });
      const { rows } = await h.admin.query<{ ok: boolean }>(
        'select on_date = app.today() as ok from app.no_spend_days where space_id = $1',
        [nBersama.spaceId],
      );
      expect(rows).toEqual([{ ok: true }]);
    });
  });

  describe('Zod menolak sebelum DB', () => {
    it.each([
      ['clientId bukan uuid', { clientId: 'bukan-uuid' }],
      ['nominal 0', { amount: 0 }],
      ['nominal pecahan', { amount: 1.5 }],
      ['nominal di atas 10^13', { amount: 10 ** 13 + 1 }],
      ['tanggal bukan YYYY-MM-DD', { occurredOn: '01/11/2026' }],
      ['deskripsi > 200', { description: 'x'.repeat(201) }],
      ['kind transfer', { kind: 'transfer' }],
    ])('createEntry %s', async (_name, patch) => {
      const connect = vi.spyOn(h.pools.app, 'connect');
      const err = await failure(
        createEntry(nPribadi, {
          clientId: randomUUID(),
          accountId: randomUUID(),
          kind: 'expense',
          amount: 1_000,
          categoryId: randomUUID(),
          ...(patch as object),
        }),
      );
      expect(err).toBeInstanceOf(ZodError);
      expect(connect).not.toHaveBeenCalled();
    });

    it('nama kategori kosong sesudah trim dan ikon tidak valid', async () => {
      const connect = vi.spyOn(h.pools.app, 'connect');
      for (const patch of [{ name: '   ' }, { name: 'x'.repeat(41) }, { icon: 'coffee' }]) {
        const err = await failure(
          createCategory(nPribadi, {
            clientId: randomUUID(),
            type: 'expense',
            name: 'Parkir',
            icon: 'Car',
            ...patch,
          }),
        );
        expect(err).toBeInstanceOf(ZodError);
      }
      expect(connect).not.toHaveBeenCalled();
    });

    it('pesan ZodError tidak membawa nominal atau deskripsi', async () => {
      const err = await failure(
        createEntry(nPribadi, {
          clientId: randomUUID(),
          accountId: randomUUID(),
          kind: 'expense',
          amount: 12_345_678.5,
          categoryId: randomUUID(),
          description: `rahasia ${'x'.repeat(200)}`,
        }),
      );
      expect(err).toBeInstanceOf(ZodError);
      const text = `${(err as Error).message} ${JSON.stringify(err)}`;
      expect(text).not.toContain('12345678');
      expect(text).not.toContain('rahasia');
    });
  });

  describe('recordProductEvent', () => {
    it('recordProductEvent tanpa nominal', async () => {
      const flowId = randomUUID();
      await recordProductEvent(h.pools, ps.n.id, {
        event: 'catat_dibuka',
        spaceKind: 'personal',
        flowId,
      });
      await recordProductEvent(h.pools, ps.n.id, {
        event: 'catat_disimpan',
        spaceKind: 'personal',
        flowId,
        taps: 3,
        durationMs: 4_200,
      });
      await recordProductEvent(h.pools, ps.n.id, {
        event: 'tanpa_pengeluaran',
        spaceKind: 'shared',
      });

      const { rows } = await h.admin.query(
        `select user_id, space_kind, event, flow_id, taps, duration_ms
           from app.product_events order by id`,
      );
      expect(rows).toEqual([
        {
          user_id: ps.n.id,
          space_kind: 'personal',
          event: 'catat_dibuka',
          flow_id: flowId,
          taps: null,
          duration_ms: null,
        },
        {
          user_id: ps.n.id,
          space_kind: 'personal',
          event: 'catat_disimpan',
          flow_id: flowId,
          taps: 3,
          duration_ms: 4_200,
        },
        {
          user_id: ps.n.id,
          space_kind: 'shared',
          event: 'tanpa_pengeluaran',
          flow_id: null,
          taps: null,
          duration_ms: null,
        },
      ]);

      const cols = await h.admin.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'app' and table_name = 'product_events' order by ordinal_position`,
      );
      const names = cols.rows.map((r) => r.column_name);
      expect(names).toEqual([
        'id',
        'user_id',
        'space_kind',
        'event',
        'flow_id',
        'taps',
        'duration_ms',
        'at',
      ]);
      for (const n of names) {
        expect(n).not.toMatch(/amount|nominal|desc|note|entry|category|account/);
      }

      // catat_disimpan/catat_batal wajib flowId, taps, durationMs: Zod menolak sebelum DB.
      const connect = vi.spyOn(h.pools.app, 'connect');
      for (const e of [
        { event: 'catat_disimpan', spaceKind: 'personal', flowId, durationMs: 1_000 },
        { event: 'catat_batal', spaceKind: 'personal', taps: 2, durationMs: 1_000 },
        { event: 'catat_disimpan', spaceKind: 'personal', flowId, taps: 101, durationMs: 1 },
        { event: 'catat_disimpan', spaceKind: 'personal', flowId, taps: 1, durationMs: 3_600_001 },
        { event: 'catat_dibuka', spaceKind: 'personal', amount: 35_000 },
        { event: 'catat_ditutup', spaceKind: 'personal' },
      ]) {
        const err = await failure(
          recordProductEvent(h.pools, ps.n.id, e as Parameters<typeof recordProductEvent>[2]),
        );
        expect(err).toBeInstanceOf(ZodError);
      }
      expect(connect).not.toHaveBeenCalled();
      expect(await count('app.product_events')).toBe(3);
    });

    it('event hanya milik user konteks (policy own): F tidak membaca event N', async () => {
      await recordProductEvent(h.pools, ps.n.id, { event: 'catat_dibuka', spaceKind: 'personal' });
      const n = await withUser(h.pools.app, must(ps.f).id, async (c) => {
        const r = await c.query('select id from app.product_events');
        return r.rowCount;
      });
      expect(n).toBe(0);
    });
  });
});
