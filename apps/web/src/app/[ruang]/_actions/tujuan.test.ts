import { redirect } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server Action Tujuan (S13): endpoint publik, gerbang `requireDataUser()` → Zod → wrapper DB, di
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
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  completeGoal: vi.fn(),
  archiveGoal: vi.fn(),
  restoreGoal: vi.fn(),
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
vi.mock('@/server/ledger/tujuan', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/tujuan')>()),
  createGoal: m.createGoal,
  updateGoal: m.updateGoal,
  completeGoal: m.completeGoal,
  archiveGoal: m.archiveGoal,
  restoreGoal: m.restoreGoal,
}));

const tujuan = await import('./tujuan');

type AnyAction = (ruang: unknown, input?: unknown) => Promise<unknown>;
const ACTIONS = tujuan as unknown as Record<string, AnyAction>;

const CASES: Record<string, { input: unknown; wrapper: keyof typeof m }> = {
  createGoalAction: {
    input: { clientId: A, accountId: B, name: 'Dana darurat', target: 10_000_000 },
    wrapper: 'createGoal',
  },
  updateGoalAction: {
    input: { goalId: A, name: 'Dana darurat', target: 12_000_000, targetOn: null },
    wrapper: 'updateGoal',
  },
  completeGoalAction: { input: { goalId: A }, wrapper: 'completeGoal' },
  archiveGoalAction: { input: { goalId: A }, wrapper: 'archiveGoal' },
  restoreGoalAction: { input: { goalId: A }, wrapper: 'restoreGoal' },
};
const NAMES = Object.keys(CASES);
const WRAPPERS = [
  'createGoal',
  'updateGoal',
  'completeGoal',
  'archiveGoal',
  'restoreGoal',
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
  it('target nol ditolak sebelum DB sebagai invalid di kolomnya', async () => {
    await expect(
      call('createGoalAction', 'pribadi', { clientId: A, accountId: B, name: 'X', target: 0 }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'target' } });
    expect(m.createGoal).not.toHaveBeenCalled();
  });

  it('nama kosong dan tanggal rusak ditolak sebelum DB', async () => {
    await expect(
      call('createGoalAction', 'pribadi', { clientId: A, accountId: B, name: '  ', target: 5 }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'name' } });
    await expect(
      call('updateGoalAction', 'pribadi', { goalId: A, name: 'X', target: 5, targetOn: 'besok' }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'targetOn' } });
    expect(m.createGoal).not.toHaveBeenCalled();
    expect(m.updateGoal).not.toHaveBeenCalled();
  });

  it('tanggal target di atas 2100-12-31 ditolak sebelum DB', async () => {
    await expect(
      call('updateGoalAction', 'pribadi', {
        goalId: A,
        name: 'X',
        target: 5,
        targetOn: '2101-01-01',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'targetOn' } });
    expect(m.updateGoal).not.toHaveBeenCalled();
  });

  it('galat DB dipetakan ke kode tanpa nominal atau nama', async () => {
    m.createGoal.mockRejectedValue(Object.assign(new Error('goal_exists'), { code: 'DK409' }));
    await expect(call('createGoalAction')).resolves.toEqual({
      ok: false,
      error: { code: 'goal_exists' },
    });
    m.completeGoal.mockRejectedValue(
      Object.assign(new Error('goal_not_reached'), { code: 'DK422' }),
    );
    await expect(call('completeGoalAction')).resolves.toEqual({
      ok: false,
      error: { code: 'goal_not_reached' },
    });
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
