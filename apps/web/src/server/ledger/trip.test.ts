import type pg from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pools } from '../db';
import { createSplit } from './patungan';
import {
  archiveTrip,
  createTrip,
  createTripSchema,
  restoreTrip,
  setEntriesTrip,
  setEntriesTripSchema,
  tripIdSchema,
  updateTrip,
  updateTripSchema,
} from './trip';
import {
  createEntry,
  createEntrySchema,
  NotInSpaceError,
  updateEntry,
  updateEntrySchema,
} from './write';

/**
 * Unit server Trip (S15 Task 6): batas Zod, parameter bernama `p_*`, pemeriksaan ruang sebelum DB.
 * Perilaku SQL diuji di `__int__/trip.int.test.ts` dan `write.int.test.ts`.
 */

const U = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./retry', () => ({
  withLedger: (_p: unknown, _u: unknown, _s: unknown, fn: (c: pg.PoolClient) => unknown) =>
    fn({ query: m.query } as unknown as pg.PoolClient),
}));

const ctx = { pools: {} as Pools, userId: U, spaceId: S };

/** Hitungan ruang (`assertInSpace`) lalu hasil `api.*`. */
function reply(r: unknown, inSpace = true) {
  m.query.mockImplementation((sql: string, params: unknown[]) => {
    if (sql.includes('select count(*)::int as n')) {
      const ids = params[0] as string[];
      return Promise.resolve({ rows: [{ n: inSpace ? new Set(ids).size : 0 }] });
    }
    return Promise.resolve({ rows: [{ r }] });
  });
}
const apiCall = () => {
  const c = m.query.mock.calls.find(([sql]) => (sql as string).includes('select api.'));
  if (!c) throw new Error('api.* tidak dipanggil');
  return { sql: c[0] as string, params: c[1] as unknown[] };
};
const checks = () =>
  m.query.mock.calls.filter(([sql]) => (sql as string).includes('select count(*)::int as n'));

beforeEach(() => {
  m.query.mockReset();
});

const base = { clientId: A, name: 'Bali', startsOn: '2026-12-12', endsOn: '2026-12-19' };

describe('createTripSchema', () => {
  it('menerima bentuk sah, anggaran opsional/null', () => {
    expect(createTripSchema.safeParse(base).success).toBe(true);
    expect(createTripSchema.safeParse({ ...base, budget: 5_000_000 }).success).toBe(true);
    expect(createTripSchema.safeParse({ ...base, budget: null }).success).toBe(true);
    expect(createTripSchema.safeParse({ ...base, endsOn: base.startsOn }).success).toBe(true);
  });

  it.each([
    ['nama kosong', { name: '   ' }, 'name'],
    ['nama 61 huruf', { name: 'x'.repeat(61) }, 'name'],
    ['mulai bukan tanggal', { startsOn: '12/12/2026' }, 'startsOn'],
    ['mulai di bawah 2000', { startsOn: '1999-12-31', endsOn: '2000-01-02' }, 'startsOn'],
    ['selesai di atas 2100', { endsOn: '2101-01-01' }, 'endsOn'],
    ['selesai sebelum mulai', { endsOn: '2026-12-11' }, 'endsOn'],
    ['anggaran 0', { budget: 0 }, 'budget'],
    ['anggaran negatif', { budget: -1 }, 'budget'],
    ['anggaran pecahan', { budget: 1.5 }, 'budget'],
    ['anggaran 10^13 + 1', { budget: 10 ** 13 + 1 }, 'budget'],
  ])('%s ditolak di kolomnya', (_n, over, field) => {
    const r = createTripSchema.safeParse({ ...base, ...over });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual([field]);
  });

  it('rentang: 366 hari boleh, 367 hari ditolak di endsOn', () => {
    expect(
      createTripSchema.safeParse({ ...base, startsOn: '2026-01-01', endsOn: '2027-01-01' }).success,
    ).toBe(true);
    const r = createTripSchema.safeParse({ ...base, startsOn: '2026-01-01', endsOn: '2027-01-02' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['endsOn']);
  });

  it('nama dipangkas dan clientId wajib uuid', () => {
    expect(createTripSchema.parse({ ...base, name: '  Bali  ' }).name).toBe('Bali');
    expect(createTripSchema.safeParse({ ...base, clientId: 'x' }).success).toBe(false);
  });
});

describe('updateTripSchema: ganti-penuh', () => {
  const full = {
    tripId: A,
    name: 'Bali',
    startsOn: '2026-12-12',
    endsOn: '2026-12-19',
    budget: null,
  };
  it('budget wajib dikirim (null = hapus anggaran), tanpa default', () => {
    expect(updateTripSchema.safeParse(full).success).toBe(true);
    expect(
      updateTripSchema.safeParse({
        tripId: A,
        name: 'Bali',
        startsOn: '2026-12-12',
        endsOn: '2026-12-19',
      }).success,
    ).toBe(false);
  });
  it('rentang rusak ditolak di endsOn', () => {
    const r = updateTripSchema.safeParse({ ...full, endsOn: '2026-12-01' });
    expect(r.error?.issues[0]?.path).toEqual(['endsOn']);
  });
});

describe('setEntriesTripSchema', () => {
  it('1..100 id unik; tripId null = lepas; tripId wajib ada', () => {
    expect(setEntriesTripSchema.safeParse({ clientId: A, tripId: B, entryIds: [C] }).success).toBe(
      true,
    );
    expect(
      setEntriesTripSchema.safeParse({ clientId: A, tripId: null, entryIds: [C, D] }).success,
    ).toBe(true);
    expect(setEntriesTripSchema.safeParse({ clientId: A, entryIds: [C] }).success).toBe(false);
  });
  it.each([
    ['kosong', []],
    ['kembar', [C, C]],
    ['bukan uuid', ['x']],
  ])('entryIds %s ditolak', (_n, ids) => {
    expect(setEntriesTripSchema.safeParse({ clientId: A, tripId: B, entryIds: ids }).success).toBe(
      false,
    );
  });
  it('101 id ditolak, 100 id boleh', () => {
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(
      setEntriesTripSchema.safeParse({ clientId: A, tripId: B, entryIds: ids(100) }).success,
    ).toBe(true);
    expect(
      setEntriesTripSchema.safeParse({ clientId: A, tripId: B, entryIds: ids(101) }).success,
    ).toBe(false);
  });
});

describe('tripId di tulis entri', () => {
  const upd = {
    clientId: A,
    entryId: B,
    expectedVersion: 1,
    accountId: C,
    amount: 1_000,
    categoryId: D,
    occurredOn: null,
    description: null,
    reimbursable: false,
  };
  it('updateEntrySchema: tripId WAJIB (tanpa default), boleh uuid atau null', () => {
    expect(updateEntrySchema.safeParse(upd).success).toBe(false);
    expect(updateEntrySchema.safeParse({ ...upd, tripId: null }).success).toBe(true);
    expect(updateEntrySchema.safeParse({ ...upd, tripId: A }).success).toBe(true);
    expect(updateEntrySchema.safeParse({ ...upd, tripId: 'x' }).success).toBe(false);
  });
  it('createEntrySchema: tripId opsional (WA, tagihan, tes lama tanpa trip)', () => {
    const cr = { clientId: A, accountId: C, kind: 'expense', amount: 1_000, categoryId: D };
    expect(createEntrySchema.safeParse(cr).success).toBe(true);
    expect(createEntrySchema.safeParse({ ...cr, tripId: null }).success).toBe(true);
    expect(createEntrySchema.safeParse({ ...cr, tripId: A }).success).toBe(true);
    expect(createEntrySchema.safeParse({ ...cr, tripId: 'x' }).success).toBe(false);
  });
  it('updateEntry tanpa tripId ditolak Zod sebelum DB (pemanggil lupa)', async () => {
    reply({ entry_id: B, version: 2, replayed: false, warnings: [] });
    await expect(
      updateEntry(ctx, upd as unknown as Parameters<typeof updateEntry>[1]),
    ).rejects.toThrow();
    expect(m.query).not.toHaveBeenCalled();
  });
});

describe('parameter bernama dan pemeriksaan ruang', () => {
  const entryOk = { entry_id: B, version: 1, replayed: false, warnings: [] };

  it('createEntry: p_trip_id terakhir; trip diperiksa di ruang konteks', async () => {
    reply(entryOk);
    await createEntry(ctx, {
      clientId: A,
      accountId: C,
      kind: 'expense',
      amount: 5_000,
      categoryId: D,
      tripId: B,
    });
    const { sql, params } = apiCall();
    expect(sql).toContain('p_trip_id => $11::uuid');
    expect(params[10]).toBe(B);
    expect(checks().map((c) => (c[1] as unknown[])[0])).toEqual([[C], [B]]);
  });

  it('createEntry tanpa trip: p_trip_id null, tanpa pemeriksaan trip', async () => {
    reply(entryOk);
    await createEntry(ctx, {
      clientId: A,
      accountId: C,
      kind: 'expense',
      amount: 5_000,
      categoryId: D,
    });
    expect(apiCall().params[10]).toBeNull();
    expect(checks()).toHaveLength(1);
  });

  it('updateEntry: p_trip_id terakhir, null melepas', async () => {
    reply({ entry_id: B, version: 2, replayed: false, warnings: [] });
    await updateEntry(ctx, {
      clientId: A,
      entryId: B,
      expectedVersion: 1,
      accountId: C,
      amount: 1_000,
      categoryId: D,
      occurredOn: null,
      description: null,
      reimbursable: false,
      tripId: null,
    });
    const { sql, params } = apiCall();
    expect(sql).toContain('p_trip_id => $11::uuid');
    expect(params[10]).toBeNull();
    expect(checks()).toHaveLength(2);
  });

  it('createEntry dengan trip ruang lain = NotInSpaceError sebelum DB', async () => {
    m.query.mockImplementation((sql: string, params: unknown[]) =>
      Promise.resolve({
        rows: [{ n: (params[0] as string[]).includes(B) ? 0 : 1, r: entryOk }],
      }),
    );
    await expect(
      createEntry(ctx, {
        clientId: A,
        accountId: C,
        kind: 'expense',
        amount: 5_000,
        categoryId: D,
        tripId: B,
      }),
    ).rejects.toBeInstanceOf(NotInSpaceError);
    expect(m.query.mock.calls.some(([s]) => (s as string).includes('select api.'))).toBe(false);
  });

  it('createSplit: p_trip_id => $10, trip diperiksa di ruang Bersama', async () => {
    reply({
      split_id: A,
      expense_entry_id: B,
      in_entry_id: C,
      out_entry_id: D,
      amount: 10_000,
      shares: [],
      version: 1,
      warnings: [],
      replayed: false,
    });
    await createSplit(ctx, {
      clientId: A,
      accountId: C,
      amount: 10_000,
      categoryId: D,
      tripId: B,
    });
    const { sql, params } = apiCall();
    expect(sql).toContain('p_trip_id => $10::uuid');
    expect(params[9]).toBe(B);
    expect(checks()).toHaveLength(1);
  });

  it('createTrip: parameter bernama; hasil dipetakan; replay', async () => {
    reply({ trip_id: B, replayed: true });
    await expect(createTrip(ctx, { ...base, budget: 7_000_000 })).resolves.toEqual({
      tripId: B,
      replayed: true,
    });
    const { sql, params } = apiCall();
    for (const p of [
      'p_client_id',
      'p_space_id',
      'p_name',
      'p_starts_on',
      'p_ends_on',
      'p_budget_amount',
    ]) {
      expect(sql).toContain(`${p} =>`);
    }
    expect(params).toEqual([A, S, 'Bali', '2026-12-12', '2026-12-19', 7_000_000]);
  });

  it('createTrip tanpa anggaran mengirim null', async () => {
    reply({ trip_id: B, replayed: false });
    await createTrip(ctx, base);
    expect(apiCall().params[5]).toBeNull();
  });

  it('createTrip: hasil DB asing ditolak Zod (rollback)', async () => {
    reply({ trip_id: 'bukan-uuid', replayed: false });
    await expect(createTrip(ctx, base)).rejects.toThrow();
  });

  it('updateTrip: trip diperiksa di ruang konteks; budget null dikirim', async () => {
    reply({ trip_id: B, status: 'active' });
    await updateTrip(ctx, {
      tripId: B,
      name: 'Bali',
      startsOn: '2026-12-12',
      endsOn: '2026-12-19',
      budget: null,
    });
    const { sql, params } = apiCall();
    expect(sql).toContain('p_trip_id => $1');
    expect(sql).toContain('p_budget_amount => $5::bigint');
    expect(params).toEqual([B, 'Bali', '2026-12-12', '2026-12-19', null]);
    expect(checks()).toHaveLength(1);
  });

  it('updateTrip untuk trip ruang lain = NotInSpaceError, tanpa menyentuh api', async () => {
    reply({ trip_id: B, status: 'active' }, false);
    await expect(
      updateTrip(ctx, {
        tripId: B,
        name: 'Bali',
        startsOn: '2026-12-12',
        endsOn: '2026-12-19',
        budget: null,
      }),
    ).rejects.toBeInstanceOf(NotInSpaceError);
    expect(m.query).toHaveBeenCalledTimes(1);
  });

  it('archiveTrip/restoreTrip: fungsi tetap per aksi, hasil archived', async () => {
    reply({ trip_id: B, status: 'archived' });
    await expect(archiveTrip(ctx, { tripId: B })).resolves.toEqual({ tripId: B, archived: true });
    expect(apiCall().sql).toBe('select api.archive_trip(p_trip_id => $1) as r');
    m.query.mockReset();
    reply({ trip_id: B, status: 'active' });
    await expect(restoreTrip(ctx, { tripId: B })).resolves.toEqual({ tripId: B, archived: false });
    expect(apiCall().sql).toBe('select api.restore_trip(p_trip_id => $1) as r');
    expect(tripIdSchema.safeParse({ tripId: 'x' }).success).toBe(false);
  });

  it('setEntriesTrip: trip dan SEMUA entri diperiksa di ruang konteks; hasil changed', async () => {
    reply({ changed: 2, replayed: false });
    await expect(
      setEntriesTrip(ctx, { clientId: A, tripId: B, entryIds: [C, D] }),
    ).resolves.toEqual({
      changed: 2,
      replayed: false,
    });
    expect(checks().map((c) => (c[1] as unknown[])[0])).toEqual([[B], [C, D]]);
    const { sql, params } = apiCall();
    expect(sql).toContain('p_entry_ids => $3::uuid[]');
    expect(params).toEqual([A, B, [C, D]]);
  });

  it('setEntriesTrip melepas (tripId null): hanya entri diperiksa', async () => {
    reply({ changed: 1, replayed: false });
    await setEntriesTrip(ctx, { clientId: A, tripId: null, entryIds: [C] });
    expect(checks()).toHaveLength(1);
    expect(apiCall().params[1]).toBeNull();
  });

  it('setEntriesTrip dengan satu entri ruang lain = NotInSpaceError, DB tidak disentuh', async () => {
    m.query.mockImplementation((_sql: string, params: unknown[]) =>
      Promise.resolve({ rows: [{ n: (params[0] as string[]).includes(D) ? 1 : 2 }] }),
    );
    await expect(
      setEntriesTrip(ctx, { clientId: A, tripId: null, entryIds: [C, D, B] }),
    ).rejects.toBeInstanceOf(NotInSpaceError);
    expect(m.query.mock.calls.some(([s]) => (s as string).includes('select api.'))).toBe(false);
  });
});
