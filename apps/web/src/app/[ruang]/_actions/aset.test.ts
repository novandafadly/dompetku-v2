import { redirect } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server Action Aset (S14): endpoint publik, gerbang `requireDataUser()` → Zod → wrapper DB, di kedua
 * ruang (K2). Dependensi server di-mock (pola `tujuan.test.ts`); SQL diuji di
 * `server/ledger/__int__/aset.int.test.ts`.
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
  createAsset: vi.fn(),
  revalueAsset: vi.fn(),
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
vi.mock('@/server/ledger/aset', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/aset')>()),
  createAsset: m.createAsset,
  revalueAsset: m.revalueAsset,
}));

const aset = await import('./aset');

type AnyAction = (ruang: unknown, input?: unknown) => Promise<unknown>;
const ACTIONS = aset as unknown as Record<string, AnyAction>;

const CASES: Record<string, { input: unknown; wrapper: 'createAsset' | 'revalueAsset' }> = {
  createAssetAction: {
    input: { clientId: A, name: 'Emas Antam', assetKind: 'emas', openingBalance: 5_000_000 },
    wrapper: 'createAsset',
  },
  revalueAssetAction: {
    input: { clientId: A, accountId: B, value: 6_000_000 },
    wrapper: 'revalueAsset',
  },
};
const NAMES = Object.keys(CASES);
const WRAPPERS = ['createAsset', 'revalueAsset'] as const;

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

describe('daftar action aset', () => {
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
  it('jenis tak dikenal, nama kosong, dan nilai minus ditolak sebelum DB', async () => {
    const base = { clientId: A, name: 'Emas', assetKind: 'emas' };
    await expect(
      call('createAssetAction', 'pribadi', { ...base, assetKind: 'kripto' }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'assetKind' } });
    await expect(call('createAssetAction', 'pribadi', { ...base, name: '  ' })).resolves.toEqual({
      ok: false,
      error: { code: 'invalid', field: 'name' },
    });
    await expect(
      call('createAssetAction', 'pribadi', { ...base, openingBalance: -1 }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'openingBalance' } });
    await expect(
      call('revalueAssetAction', 'pribadi', { clientId: A, accountId: B, value: -5 }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'value' } });
    expect(m.createAsset).not.toHaveBeenCalled();
    expect(m.revalueAsset).not.toHaveBeenCalled();
  });

  it('nama lebih dari 60 huruf dan tanggal rusak ditolak sebelum DB', async () => {
    await expect(
      call('createAssetAction', 'pribadi', {
        clientId: A,
        name: 'x'.repeat(61),
        assetKind: 'emas',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'name' } });
    await expect(
      call('revalueAssetAction', 'pribadi', { clientId: A, accountId: B, value: 1, on: 'kemarin' }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'on' } });
  });

  it('galat DB dipetakan ke kode tanpa nominal atau nama', async () => {
    m.revalueAsset.mockRejectedValue(
      Object.assign(new Error('before_latest_entry'), { code: 'DK422' }),
    );
    await expect(call('revalueAssetAction')).resolves.toEqual({
      ok: false,
      error: { code: 'before_latest_entry' },
    });
    m.createAsset.mockRejectedValue(
      Object.assign(new Error('pocket_personal_only'), { code: 'DK422' }),
    );
    await expect(call('createAssetAction', 'bersama')).resolves.toEqual({
      ok: false,
      error: { code: 'pocket_personal_only' },
    });
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
