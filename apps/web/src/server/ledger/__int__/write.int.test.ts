import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { withUser } from '../../db';
import { toLedgerError } from '../errors';
import { recordProductEvent } from '../events';
import { createReimbursement, openReimbursables } from '../reimburse';
import {
  archiveAccount,
  archiveCategory,
  createAccount,
  createCategory,
  createEntry,
  createSpaceTransfer,
  createTransfer,
  markNoSpendDay,
  moveEntryToSpace,
  reconcileBalance,
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

async function wallet(
  ctx: LedgerCtx,
  openingBalance: number,
  name = 'BCA',
  pocket: 'operasional' | 'tabungan' | 'kantor' = 'operasional',
): Promise<string> {
  const { accountId } = await createAccount(ctx, {
    clientId: randomUUID(),
    name,
    pocket,
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

describe('wrapper S7 (N, F bergabung, Luar)', () => {
  let ps: Personas;
  let luar: Persona;
  let nPribadi: LedgerCtx;
  let nBersama: LedgerCtx;
  let fPribadi: LedgerCtx;
  let fBersama: LedgerCtx;

  beforeEach(async () => {
    await resetLedger(h);
    ps = await seedPersonas(h, { farida: 'bergabung', luar: true });
    const f = must(ps.f);
    luar = must(ps.luar);
    const shared = await spaceIdOf(h, ps.n.id, 'shared');
    nPribadi = {
      pools: h.pools,
      userId: ps.n.id,
      spaceId: await spaceIdOf(h, ps.n.id, 'personal'),
    };
    nBersama = { pools: h.pools, userId: ps.n.id, spaceId: shared };
    fPribadi = { pools: h.pools, userId: f.id, spaceId: await spaceIdOf(h, f.id, 'personal') };
    fBersama = { pools: h.pools, userId: f.id, spaceId: shared };
  });

  /** Talangan kantor: pengeluaran Pribadi reimbursable. */
  async function talangan(ctx: LedgerCtx, accountId: string, amount: number): Promise<string> {
    const { entryId } = await createEntry(ctx, {
      clientId: randomUUID(),
      accountId,
      kind: 'expense',
      amount,
      categoryId: await categoryOf(ctx.spaceId, 'expense'),
      description: 'hotel dinas',
      reimbursable: true,
    });
    return entryId;
  }

  describe('createSpaceTransfer', () => {
    it('setor Pribadi → Bersama dengan biaya: dua kaki bertaut, saldo, replay', async () => {
      const bca = await wallet(nPribadi, 1_000_000, 'BCA');
      const kas = await wallet(nBersama, 0, 'Kas Rumah');
      const input = {
        clientId: randomUUID(),
        fromAccountId: bca,
        toSpaceId: nBersama.spaceId,
        toAccountId: kas,
        amount: 400_000,
        fee: 2_500,
        description: 'setor gaji',
        sharedNote: 'Setoran November',
        allowNegative: false,
      };

      const first = await createSpaceTransfer(nPribadi, input);
      expect(first).toEqual({
        entryId: expect.stringMatching(UUID) as string,
        linkedEntryId: expect.stringMatching(UUID) as string,
        linkId: expect.stringMatching(UUID) as string,
        version: 1,
        replayed: false,
      });
      await expect(createSpaceTransfer(nPribadi, input)).resolves.toEqual({
        ...first,
        replayed: true,
      });
      expect([await balance(bca), await balance(kas)]).toEqual([597_500, 400_000]);

      const { rows } = await h.admin.query<{
        id: string;
        space_id: string;
        description: string | null;
        shared_note: string | null;
        direction: string;
      }>(
        `select id, space_id, description, shared_note, direction::text as direction
           from app.entries where link_id = $1 order by direction`,
        [first.linkId],
      );
      expect(rows).toEqual([
        {
          id: first.linkedEntryId,
          space_id: nBersama.spaceId,
          description: null,
          shared_note: 'Setoran November',
          direction: 'in',
        },
        {
          id: first.entryId,
          space_id: nPribadi.spaceId,
          description: 'setor gaji',
          shared_note: null,
          direction: 'out',
        },
      ]);
    });

    it('ruang eksplisit: dompet sumber/tujuan di ruang lain, Pribadi pasangan, Luar = not_found', async () => {
      const bca = await wallet(nPribadi, 1_000_000, 'BCA');
      const kas = await wallet(nBersama, 1_000_000, 'Kas Rumah');
      const bca2 = await wallet(nPribadi, 1_000_000, 'Dana');
      const kas2 = await wallet(nBersama, 1_000_000, 'Tabungan Rumah');
      const fBca = await wallet(fPribadi, 1_000_000, 'BCA F');
      const base = {
        clientId: randomUUID(),
        fromAccountId: bca,
        toSpaceId: nBersama.spaceId,
        toAccountId: kas,
        amount: 10_000,
        fee: 0,
        allowNegative: false,
      };
      const before = await count('app.entries');
      const cases: [LedgerCtx, object][] = [
        // Dompet sumber bukan di ruang konteks (dompet Bersama lewat konteks Pribadi N).
        [nPribadi, { fromAccountId: kas2 }],
        // Dompet sumber Pribadi pasangan.
        [nPribadi, { fromAccountId: fBca }],
        // Dompet tujuan bukan di ruang tujuan: tanpa cek wrapper, DB akan mencatat transfer
        // satu ruang Pribadi walau pemanggil meminta antar ruang.
        [nPribadi, { toAccountId: bca2 }],
        // Ruang tujuan = Pribadi pasangan (N bukan anggota).
        [nBersama, { fromAccountId: kas, toSpaceId: fPribadi.spaceId, toAccountId: fBca }],
        // Luar: bukan anggota ruang sumber maupun tujuan.
        [{ ...nPribadi, userId: luar.id }, {}],
        [
          { ...nBersama, userId: luar.id },
          { fromAccountId: kas, toSpaceId: nPribadi.spaceId },
        ],
      ];
      for (const [ctx, patch] of cases) {
        expect(
          await ledgerCode(createSpaceTransfer(ctx, { ...base, clientId: randomUUID(), ...patch })),
        ).toEqual({ code: 'not_found' });
      }
      expect(await count('app.entries')).toBe(before);
      expect(await Promise.all([bca, bca2, kas, kas2, fBca].map((a) => balance(a)))).toEqual([
        1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000,
      ]);
    });

    it('dompet kantor = cross_space_kantor; saldo kurang = saldo_negatif lalu simpan tetap', async () => {
      const kantor = await wallet(nPribadi, 1_000_000, 'Kartu Kantor', 'kantor');
      const tipis = await wallet(nPribadi, 5_000, 'Tunai');
      const kas = await wallet(nBersama, 0, 'Kas Rumah');
      const base = {
        toSpaceId: nBersama.spaceId,
        toAccountId: kas,
        amount: 10_000,
        fee: 0,
        allowNegative: false,
      };
      expect(
        await ledgerCode(
          createSpaceTransfer(nPribadi, { ...base, clientId: randomUUID(), fromAccountId: kantor }),
        ),
      ).toEqual({ code: 'cross_space_kantor' });

      const clientId = randomUUID();
      expect(
        await ledgerCode(
          createSpaceTransfer(nPribadi, { ...base, clientId, fromAccountId: tipis }),
        ),
      ).toEqual({ code: 'saldo_negatif' });
      const saved = await createSpaceTransfer(nPribadi, {
        ...base,
        clientId,
        fromAccountId: tipis,
        allowNegative: true,
      });
      expect(saved.replayed).toBe(false);
      expect([await balance(tipis), await balance(kas)]).toEqual([-5_000, 10_000]);
    });

    it('Zod: ruang tujuan = ruang konteks, biaya negatif, catatan > 200 ditolak sebelum DB', async () => {
      const connect = vi.spyOn(h.pools.app, 'connect');
      const base = {
        clientId: randomUUID(),
        fromAccountId: randomUUID(),
        toSpaceId: nBersama.spaceId,
        toAccountId: randomUUID(),
        amount: 10_000,
        fee: 0,
        allowNegative: false,
      };
      for (const patch of [
        { toSpaceId: nPribadi.spaceId },
        { toSpaceId: 'bukan-uuid' },
        { fee: -1 },
        { fee: 0.5 },
        { sharedNote: 'x'.repeat(201) },
      ]) {
        expect(await failure(createSpaceTransfer(nPribadi, { ...base, ...patch }))).toBeInstanceOf(
          ZodError,
        );
      }
      expect(connect).not.toHaveBeenCalled();
    });
  });

  describe('reconcileBalance', () => {
    it('selisih 0 = tanpa entri; naik/turun = entri adjustment bertanda; replay', async () => {
      const bca = await wallet(nPribadi, 100_000, 'BCA');

      const sama = await reconcileBalance(nPribadi, {
        clientId: randomUUID(),
        accountId: bca,
        actualBalance: 100_000,
      });
      expect(sama).toEqual({ entryId: null, difference: 0, replayed: false });
      expect(await count(`app.entries where kind = 'adjustment'`)).toBe(0);

      const turunInput = { clientId: randomUUID(), accountId: bca, actualBalance: 92_500 };
      const turun = await reconcileBalance(nPribadi, turunInput);
      expect(turun).toEqual({
        entryId: expect.stringMatching(UUID) as string,
        difference: -7_500,
        replayed: false,
      });
      await expect(reconcileBalance(nPribadi, turunInput)).resolves.toEqual({
        ...turun,
        replayed: true,
      });
      expect(await balance(bca)).toBe(92_500);

      const naik = await reconcileBalance(nPribadi, {
        clientId: randomUUID(),
        accountId: bca,
        actualBalance: 100_000,
      });
      expect(naik.difference).toBe(7_500);
      expect(await balance(bca)).toBe(100_000);
      expect(await count(`app.entries where kind = 'adjustment'`)).toBe(2);
    });

    it('dompet Pribadi dari konteks Bersama dan Luar = not_found', async () => {
      const bca = await wallet(nPribadi, 100_000, 'BCA');
      for (const ctx of [nBersama, fBersama, { ...nPribadi, userId: luar.id }]) {
        expect(
          await ledgerCode(
            reconcileBalance(ctx, { clientId: randomUUID(), accountId: bca, actualBalance: 0 }),
          ),
        ).toEqual({ code: 'not_found' });
      }
      expect(await balance(bca)).toBe(100_000);
    });
  });

  describe('dompet: arsip dan nama unik', () => {
    it('arsip saldo ≠ 0 = balance_not_zero; saldo 0 = archived, diulang tetap archived', async () => {
      const isi = await wallet(nPribadi, 10_000, 'BCA');
      const kosong = await wallet(nPribadi, 0, 'Lama');
      expect(await ledgerCode(archiveAccount(nPribadi, isi))).toEqual({
        code: 'balance_not_zero',
      });
      await expect(archiveAccount(nPribadi, kosong)).resolves.toEqual({ archived: true });
      await expect(archiveAccount(nPribadi, kosong)).resolves.toEqual({ archived: true });
      expect(await count('app.accounts where archived_at is not null')).toBe(1);
    });

    it('arsip dompet ruang lain atau oleh Luar = not_found', async () => {
      const kosong = await wallet(nPribadi, 0, 'Lama');
      for (const ctx of [nBersama, fBersama, fPribadi, { ...nPribadi, userId: luar.id }]) {
        expect(await ledgerCode(archiveAccount(ctx, kosong))).toEqual({ code: 'not_found' });
      }
      expect(await count('app.accounts where archived_at is not null')).toBe(0);
    });

    it('nama dompet ganda (beda huruf/spasi) = name_taken; sesudah arsip boleh dipakai lagi', async () => {
      const lama = await wallet(nPribadi, 0, 'BCA');
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const err = await failure(wallet(nPribadi, 0, '  bca '));
      expect(toLedgerError(err)).toEqual({ code: 'name_taken' });
      expect(log).not.toHaveBeenCalled();
      // Ruang lain boleh memakai nama yang sama.
      await wallet(nBersama, 0, 'BCA');
      await archiveAccount(nPribadi, lama);
      await expect(wallet(nPribadi, 0, 'BCA')).resolves.toMatch(UUID);
    });
  });

  describe('talangan dan reimburse', () => {
    it('reimburse sebagian lalu lunas; openReimbursables; melebihi = reimbursement_exceeds', async () => {
      const bca = await wallet(nPribadi, 1_000_000, 'BCA');
      const t = await talangan(nPribadi, bca, 500_000);
      expect(await openReimbursables(nPribadi)).toEqual([
        {
          entryId: t,
          occurredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
          description: 'hotel dinas',
          accountId: bca,
          amount: 500_000,
          reimbursed: 0,
          remaining: 500_000,
        },
      ]);

      const input = { clientId: randomUUID(), entryId: t, accountId: bca, amount: 300_000 };
      const r1 = await createReimbursement(nPribadi, input);
      expect(r1).toEqual({
        entryId: expect.stringMatching(UUID) as string,
        remaining: 200_000,
        replayed: false,
      });
      expect((await openReimbursables(nPribadi))[0]).toMatchObject({
        reimbursed: 300_000,
        remaining: 200_000,
      });

      const r2 = await createReimbursement(nPribadi, {
        clientId: randomUUID(),
        entryId: t,
        accountId: bca,
        amount: 200_000,
        description: 'transfer kantor',
      });
      expect(r2.remaining).toBe(0);
      expect(await openReimbursables(nPribadi)).toEqual([]);
      // Replay: sisa = nilai saat pertama dicatat (pemanggil membaca ulang openReimbursables).
      await expect(createReimbursement(nPribadi, input)).resolves.toEqual({
        ...r1,
        replayed: true,
      });
      expect(
        await ledgerCode(
          createReimbursement(nPribadi, {
            clientId: randomUUID(),
            entryId: t,
            accountId: bca,
            amount: 1,
          }),
        ),
      ).toEqual({ code: 'reimbursement_exceeds' });
      expect(await balance(bca)).toBe(1_000_000);
    });

    it('bukan talangan = not_reimbursable; restore reimburse melebihi = reimbursement_exceeds', async () => {
      const bca = await wallet(nPribadi, 1_000_000, 'BCA');
      const biasa = await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: bca,
        kind: 'expense',
        amount: 50_000,
        categoryId: await categoryOf(nPribadi.spaceId, 'expense'),
      });
      expect(
        await ledgerCode(
          createReimbursement(nPribadi, {
            clientId: randomUUID(),
            entryId: biasa.entryId,
            accountId: bca,
            amount: 1_000,
          }),
        ),
      ).toEqual({ code: 'not_reimbursable' });

      const t = await talangan(nPribadi, bca, 100_000);
      const r1 = await createReimbursement(nPribadi, {
        clientId: randomUUID(),
        entryId: t,
        accountId: bca,
        amount: 100_000,
      });
      await voidEntry(nPribadi, {
        clientId: randomUUID(),
        entryId: r1.entryId,
        expectedVersion: 1,
      });
      await createReimbursement(nPribadi, {
        clientId: randomUUID(),
        entryId: t,
        accountId: bca,
        amount: 100_000,
      });
      expect(
        await ledgerCode(
          restoreEntry(nPribadi, {
            clientId: randomUUID(),
            entryId: r1.entryId,
            expectedVersion: 2,
          }),
        ),
      ).toEqual({ code: 'reimbursement_exceeds' });
      // Talangan dengan reimburse hidup tidak bisa "Tidak diganti".
      expect(
        await ledgerCode(
          updateEntry(nPribadi, {
            clientId: randomUUID(),
            entryId: t,
            expectedVersion: 1,
            accountId: bca,
            amount: 100_000,
            categoryId: await categoryOf(nPribadi.spaceId, 'expense'),
            occurredOn: null,
            description: 'hotel dinas',
            reimbursable: false,
          }),
        ),
      ).toEqual({ code: 'reimbursement_exists' });
    });

    it('ruang eksplisit: talangan/dompet ruang lain, F, Luar = not_found; openReimbursables per ruang', async () => {
      const bca = await wallet(nPribadi, 1_000_000, 'BCA');
      const kas = await wallet(nBersama, 1_000_000, 'Kas Rumah');
      const t = await talangan(nPribadi, bca, 100_000);
      const cases: [LedgerCtx, string][] = [
        [nBersama, kas], // talangan Pribadi dari konteks Bersama
        [nPribadi, kas], // dompet Bersama untuk talangan Pribadi
        [fBersama, kas],
        [fPribadi, bca],
        [{ ...nPribadi, userId: luar.id }, bca],
      ];
      for (const [ctx, accountId] of cases) {
        expect(
          await ledgerCode(
            createReimbursement(ctx, {
              clientId: randomUUID(),
              entryId: t,
              accountId,
              amount: 1_000,
            }),
          ),
        ).toEqual({ code: 'not_found' });
      }
      expect(await count(`app.entries where kind = 'reimbursement'`)).toBe(0);
      expect(await openReimbursables(nBersama)).toEqual([]);
      expect(await openReimbursables(fPribadi)).toEqual([]);
      expect(await ledgerCode(openReimbursables({ ...nPribadi, userId: luar.id }))).toEqual({
        code: 'not_found',
      });
      expect(
        await ledgerCode(openReimbursables({ ...fPribadi, spaceId: nPribadi.spaceId })),
      ).toEqual({ code: 'not_found' });
    });
  });

  describe('moveEntryToSpace', () => {
    it('pindah Pribadi → Bersama: entri baru di tujuan, asal batal + entry_moved, deskripsi tidak ikut', async () => {
      const bca = await wallet(nPribadi, 500_000, 'BCA');
      const kas = await wallet(nBersama, 500_000, 'Kas Rumah');
      const { entryId } = await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: bca,
        kind: 'expense',
        amount: 80_000,
        categoryId: await categoryOf(nPribadi.spaceId, 'expense'),
        description: 'belanja pribadi',
      });
      const input = {
        clientId: randomUUID(),
        entryId,
        expectedVersion: 1,
        toSpaceId: nBersama.spaceId,
        accountId: kas,
        categoryId: await categoryOf(nBersama.spaceId, 'expense'),
      };

      const moved = await moveEntryToSpace(nPribadi, input);
      expect(moved).toEqual({
        entryId: expect.stringMatching(UUID) as string,
        version: 1,
        replayed: false,
      });
      expect(moved.entryId).not.toBe(entryId);
      await expect(moveEntryToSpace(nPribadi, input)).resolves.toEqual({
        ...moved,
        replayed: true,
      });
      expect([await balance(bca), await balance(kas)]).toEqual([500_000, 420_000]);
      const { rows } = await h.admin.query<{ space_id: string; description: string | null }>(
        'select space_id, description from app.entries where id = $1',
        [moved.entryId],
      );
      expect(rows[0]).toEqual({ space_id: nBersama.spaceId, description: null });

      expect(
        await ledgerCode(
          restoreEntry(nPribadi, { clientId: randomUUID(), entryId, expectedVersion: 2 }),
        ),
      ).toEqual({ code: 'entry_moved' });
    });

    it('keepDescription ikut ke Bersama; allowNegative melewati saldo_negatif', async () => {
      const bca = await wallet(nPribadi, 500_000, 'BCA');
      const kas = await wallet(nBersama, 0, 'Kas Rumah');
      const { entryId } = await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: bca,
        kind: 'expense',
        amount: 80_000,
        categoryId: await categoryOf(nPribadi.spaceId, 'expense'),
        description: 'galon',
      });
      const input = {
        clientId: randomUUID(),
        entryId,
        expectedVersion: 1,
        toSpaceId: nBersama.spaceId,
        accountId: kas,
        categoryId: await categoryOf(nBersama.spaceId, 'expense'),
        keepDescription: true,
      };
      expect(await ledgerCode(moveEntryToSpace(nPribadi, input))).toEqual({
        code: 'saldo_negatif',
      });
      const moved = await moveEntryToSpace(nPribadi, { ...input, allowNegative: true });
      const { rows } = await h.admin.query<{ description: string | null }>(
        'select description from app.entries where id = $1',
        [moved.entryId],
      );
      expect(rows[0]?.description).toBe('galon');
      expect(await balance(kas)).toBe(-80_000);
    });

    it('bukan pencatat = not_creator; transfer = kind_not_movable; kantor = cross_space_kantor', async () => {
      const kas = await wallet(nBersama, 500_000, 'Kas Rumah');
      const fBca = await wallet(fPribadi, 500_000, 'BCA F');
      const bca = await wallet(nPribadi, 500_000, 'BCA');
      const kantor = await wallet(nPribadi, 500_000, 'Kartu Kantor', 'kantor');
      const shared = await createEntry(fBersama, {
        clientId: randomUUID(),
        accountId: kas,
        kind: 'expense',
        amount: 10_000,
        categoryId: await categoryOf(nBersama.spaceId, 'expense'),
      });
      const pribadiCat = await categoryOf(nPribadi.spaceId, 'expense');
      // N memindahkan catatan F di Bersama ke Pribadi N.
      expect(
        await ledgerCode(
          moveEntryToSpace(nBersama, {
            clientId: randomUUID(),
            entryId: shared.entryId,
            expectedVersion: 1,
            toSpaceId: nPribadi.spaceId,
            accountId: bca,
            categoryId: pribadiCat,
          }),
        ),
      ).toEqual({ code: 'not_creator' });

      const tf = await createSpaceTransfer(nPribadi, {
        clientId: randomUUID(),
        fromAccountId: bca,
        toSpaceId: nBersama.spaceId,
        toAccountId: kas,
        amount: 10_000,
        fee: 0,
        allowNegative: false,
      });
      expect(
        await ledgerCode(
          moveEntryToSpace(nBersama, {
            clientId: randomUUID(),
            entryId: tf.linkedEntryId,
            expectedVersion: 1,
            toSpaceId: nPribadi.spaceId,
            accountId: bca,
            categoryId: pribadiCat,
          }),
        ),
      ).toEqual({ code: 'kind_not_movable' });

      const dariKantor = await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: kantor,
        kind: 'expense',
        amount: 10_000,
        categoryId: pribadiCat,
      });
      expect(
        await ledgerCode(
          moveEntryToSpace(nPribadi, {
            clientId: randomUUID(),
            entryId: dariKantor.entryId,
            expectedVersion: 1,
            toSpaceId: nBersama.spaceId,
            accountId: kas,
            categoryId: await categoryOf(nBersama.spaceId, 'expense'),
          }),
        ),
      ).toEqual({ code: 'cross_space_kantor' });
      expect(fBca).toMatch(UUID);
    });

    it('ruang eksplisit: entri/dompet/kategori di luar ruang, Pribadi pasangan, Luar = not_found', async () => {
      const bca = await wallet(nPribadi, 500_000, 'BCA');
      const kas = await wallet(nBersama, 500_000, 'Kas Rumah');
      const fBca = await wallet(fPribadi, 500_000, 'BCA F');
      const pribadiCat = await categoryOf(nPribadi.spaceId, 'expense');
      const bersamaCat = await categoryOf(nBersama.spaceId, 'expense');
      const fCat = await categoryOf(fPribadi.spaceId, 'expense');
      const { entryId } = await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: bca,
        kind: 'expense',
        amount: 10_000,
        categoryId: pribadiCat,
      });
      const base = {
        entryId,
        expectedVersion: 1,
        toSpaceId: nBersama.spaceId,
        accountId: kas,
        categoryId: bersamaCat,
      };
      const cases: [LedgerCtx, object][] = [
        [nBersama, { toSpaceId: nPribadi.spaceId, accountId: bca, categoryId: pribadiCat }],
        [nPribadi, { accountId: bca }],
        [nPribadi, { categoryId: pribadiCat }],
        [nPribadi, { toSpaceId: fPribadi.spaceId, accountId: fBca, categoryId: fCat }],
        [{ ...nPribadi, userId: luar.id }, {}],
        [fPribadi, { toSpaceId: nBersama.spaceId }],
      ];
      for (const [ctx, patch] of cases) {
        expect(
          await ledgerCode(moveEntryToSpace(ctx, { ...base, clientId: randomUUID(), ...patch })),
        ).toEqual({ code: 'not_found' });
      }
      const { rows } = await h.admin.query<{ version: number; voided: boolean }>(
        'select version, voided_at is not null as voided from app.entries where id = $1',
        [entryId],
      );
      expect(rows[0]).toEqual({ version: 1, voided: false });
      expect([await balance(bca), await balance(kas), await balance(fBca)]).toEqual([
        490_000, 500_000, 500_000,
      ]);
    });
  });

  describe('utang S6: lintas ruang', () => {
    it('restoreEntry entri ruang lain dengan ctx ruang sendiri = not_found', async () => {
      const bca = await wallet(nPribadi, 100_000, 'BCA');
      const kas = await wallet(nBersama, 100_000, 'Kas Rumah');
      const pribadi = await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: bca,
        kind: 'expense',
        amount: 10_000,
        categoryId: await categoryOf(nPribadi.spaceId, 'expense'),
      });
      const bersama = await createEntry(fBersama, {
        clientId: randomUUID(),
        accountId: kas,
        kind: 'expense',
        amount: 10_000,
        categoryId: await categoryOf(nBersama.spaceId, 'expense'),
      });
      await voidEntry(nPribadi, {
        clientId: randomUUID(),
        entryId: pribadi.entryId,
        expectedVersion: 1,
      });
      await voidEntry(fBersama, {
        clientId: randomUUID(),
        entryId: bersama.entryId,
        expectedVersion: 1,
      });

      const cases: [LedgerCtx, string][] = [
        [nBersama, pribadi.entryId], // N anggota Pribadinya, tetapi konteks Bersama
        [fPribadi, bersama.entryId], // F anggota Bersama, tetapi konteks Pribadi F
        [fBersama, pribadi.entryId],
        [{ ...nPribadi, userId: luar.id }, pribadi.entryId],
      ];
      for (const [ctx, entryId] of cases) {
        expect(
          await ledgerCode(
            restoreEntry(ctx, { clientId: randomUUID(), entryId, expectedVersion: 2 }),
          ),
        ).toEqual({ code: 'not_found' });
      }
      expect(
        await count('app.entries where id = any($1) and voided_at is not null', [
          [pribadi.entryId, bersama.entryId],
        ]),
      ).toBe(2);
    });

    it('createCategory/updateCategory dengan parentId kategori ruang asing = not_found', async () => {
      const pribadiParent = await categoryOf(nPribadi.spaceId, 'expense');
      const fParent = await categoryOf(fPribadi.spaceId, 'expense');
      const { categoryId: bersamaChild } = await createCategory(nBersama, {
        clientId: randomUUID(),
        type: 'expense',
        name: 'Galon',
        icon: 'Coffee',
      });
      const before = await count('app.categories');
      for (const parentId of [pribadiParent, fParent]) {
        expect(
          await ledgerCode(
            createCategory(nBersama, {
              clientId: randomUUID(),
              type: 'expense',
              name: 'Anak asing',
              icon: 'Coffee',
              parentId,
            }),
          ),
        ).toEqual({ code: 'not_found' });
        expect(
          await ledgerCode(
            updateCategory(nBersama, {
              categoryId: bersamaChild,
              name: 'Galon',
              icon: 'Coffee',
              parentId,
            }),
          ),
        ).toEqual({ code: 'not_found' });
      }
      expect(await count('app.categories')).toBe(before);
      const { rows } = await h.admin.query<{ parent_id: string | null }>(
        'select parent_id from app.categories where id = $1',
        [bersamaChild],
      );
      expect(rows[0]?.parent_id).toBeNull();
    });
  });
});
