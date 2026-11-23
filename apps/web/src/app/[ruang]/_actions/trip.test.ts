import { redirect } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server Action Trip (S15): endpoint publik, gerbang `requireDataUser()` → Zod → wrapper DB, di
 * kedua ruang (K1). Dependensi server di-mock (pola `patungan.test.ts`); SQL diuji di
 * `server/ledger/__int__/tujuan.int.test.ts`.
 */

const POOLS = { auth: {}, app: {} };
const USER_ID = '11111111-1111-4111-8111-111111111111';
const SPACE_ID = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const m = vi.hoisted(() => ({
  requireDataUser: vi.fn(),
  resolveSpace: vi.fn(),
  refresh: vi.fn(),
  createTrip: vi.fn(),
  updateTrip: vi.fn(),
  archiveTrip: vi.fn(),
  restoreTrip: vi.fn(),
  setEntriesTrip: vi.fn(),
}));

vi.mock('@/server/auth/next', () => ({
  requireDataUser: m.requireDataUser,
  authService: () => ({ pools: POOLS }),
}));
vi.mock('next/cache', () => ({ refresh: m.refresh, revalidatePath: vi.fn() }));
vi.mock('@/server/ledger/space', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/space')>()),
  resolveSpace: m.resolveSpace,
}));
vi.mock('@/server/ledger/trip', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/trip')>()),
  createTrip: m.createTrip,
  updateTrip: m.updateTrip,
  archiveTrip: m.archiveTrip,
  restoreTrip: m.restoreTrip,
  setEntriesTrip: m.setEntriesTrip,
}));

const trip = await import('./trip');

type AnyAction = (ruang: unknown, input?: unknown) => Promise<unknown>;
const ACTIONS = trip as unknown as Record<string, AnyAction>;

const RANGE = { startsOn: '2026-12-12', endsOn: '2026-12-19' };
const CASES: Record<string, { input: unknown; wrapper: keyof typeof m }> = {
  createTripAction: {
    input: { clientId: A, name: 'Bali', ...RANGE, budget: 5_000_000 },
    wrapper: 'createTrip',
  },
  updateTripAction: {
    input: { tripId: A, name: 'Bali', ...RANGE, budget: null },
    wrapper: 'updateTrip',
  },
  archiveTripAction: { input: { tripId: A }, wrapper: 'archiveTrip' },
  restoreTripAction: { input: { tripId: A }, wrapper: 'restoreTrip' },
  setEntriesTripAction: {
    input: { clientId: A, tripId: A, entryIds: [B] },
    wrapper: 'setEntriesTrip',
  },
};
const NAMES = Object.keys(CASES);
const WRAPPERS = [
  'createTrip',
  'updateTrip',
  'archiveTrip',
  'restoreTrip',
  'setEntriesTrip',
] as const;

function call(name: string, ruang: unknown = 'pribadi', input?: unknown): Promise<unknown> {
  const action = ACTIONS[name];
  const c = CASES[name];
  if (!action || !c) throw new Error(`action ${name} tidak dikenal`);
  return action(ruang, input ?? c.input);
}

beforeEach(() => {
  m.requireDataUser.mockResolvedValue({ userId: USER_ID });
  m.resolveSpace.mockResolvedValue({ spaceId: SPACE_ID, kind: 'personal' });
  for (const w of WRAPPERS) m[w].mockResolvedValue({ ok: 1 });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('daftar action tujuan', () => {
  it('setiap action exported punya kasus uji', () => {
    expect(Object.keys(ACTIONS).sort()).toEqual([...NAMES].sort());
  });
});

describe('gerbang', () => {
  it.each(NAMES)('menolak di mode prototipe: %s', async (name) => {
    m.requireDataUser.mockResolvedValue(null);
    await expect(call(name)).rejects.toThrow('prototipe');
    expect(m.resolveSpace).not.toHaveBeenCalled();
    for (const w of WRAPPERS) expect(m[w]).not.toHaveBeenCalled();
  });

  it.each(NAMES)('requireDataUser sebelum resolveSpace sebelum wrapper: %s', async (name) => {
    const c = CASES[name];
    if (!c) throw new Error(name);
    await call(name);
    const gate = m.requireDataUser.mock.invocationCallOrder[0];
    const resolve = m.resolveSpace.mock.invocationCallOrder[0];
    const wrapper = m[c.wrapper].mock.invocationCallOrder[0];
    expect(gate).toBeLessThan(resolve ?? 0);
    expect(resolve).toBeLessThan(wrapper ?? 0);
    expect(m.resolveSpace).toHaveBeenCalledWith(POOLS, USER_ID, 'pribadi');
  });

  it.each(NAMES)('redirect sesi diteruskan: %s', async (name) => {
    m.requireDataUser.mockImplementation(() => redirect('/masuk'));
    await expect(call(name)).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT') as unknown,
    });
    for (const w of WRAPPERS) expect(m[w]).not.toHaveBeenCalled();
  });

  it.each(NAMES)(
    'kedua ruang diterima (Bersama juga), refresh sesudah sukses: %s',
    async (name) => {
      m.resolveSpace.mockResolvedValue({ spaceId: SPACE_ID, kind: 'shared' });
      await expect(call(name, 'bersama')).resolves.toEqual({ ok: true, value: { ok: 1 } });
      expect(m.refresh).toHaveBeenCalledTimes(1);
    },
  );
});

describe('input', () => {
  it('nama kosong dan tanggal rusak ditolak sebelum DB sebagai invalid di kolomnya', async () => {
    await expect(
      call('createTripAction', 'pribadi', { clientId: A, name: '  ', ...RANGE }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'name' } });
    await expect(
      call('createTripAction', 'pribadi', { clientId: A, name: 'X', ...RANGE, startsOn: 'besok' }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'startsOn' } });
    expect(m.createTrip).not.toHaveBeenCalled();
  });

  it('selesai sebelum mulai dan rentang > 366 hari ditolak di endsOn', async () => {
    await expect(
      call('createTripAction', 'pribadi', {
        clientId: A,
        name: 'X',
        ...RANGE,
        endsOn: '2026-12-01',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'endsOn' } });
    await expect(
      call('updateTripAction', 'pribadi', {
        tripId: A,
        name: 'X',
        startsOn: '2026-01-01',
        endsOn: '2027-01-02',
        budget: null,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'endsOn' } });
    expect(m.createTrip).not.toHaveBeenCalled();
    expect(m.updateTrip).not.toHaveBeenCalled();
  });

  it('anggaran nol ditolak; ubah tanpa budget ditolak (ganti-penuh)', async () => {
    await expect(
      call('createTripAction', 'pribadi', { clientId: A, name: 'X', ...RANGE, budget: 0 }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'budget' } });
    await expect(
      call('updateTripAction', 'pribadi', { tripId: A, name: 'X', ...RANGE }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'budget' } });
  });

  it('setEntriesTrip: 0 atau 101 id dan id kembar ditolak sebelum DB', async () => {
    for (const entryIds of [[], [B, B], Array.from({ length: 101 }, () => B)]) {
      await expect(
        call('setEntriesTripAction', 'pribadi', { clientId: A, tripId: A, entryIds }),
      ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'entryIds' } });
    }
    expect(m.setEntriesTrip).not.toHaveBeenCalled();
  });

  it('galat DB dipetakan ke kode tanpa nominal atau nama', async () => {
    m.createTrip.mockRejectedValue(
      Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'trips_name_unique' }),
    );
    await expect(call('createTripAction')).resolves.toEqual({
      ok: false,
      error: { code: 'name_taken' },
    });
    m.setEntriesTrip.mockRejectedValue(
      Object.assign(new Error('trip_entry_invalid'), { code: 'DK422' }),
    );
    await expect(call('setEntriesTripAction')).resolves.toEqual({
      ok: false,
      error: { code: 'trip_entry_invalid' },
    });
    m.archiveTrip.mockRejectedValue(Object.assign(new Error('trip_not_found'), { code: 'DK404' }));
    await expect(call('archiveTripAction')).resolves.toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
