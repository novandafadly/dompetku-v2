import { redirect } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server Action Patungan (S12): endpoint publik, gerbang `requireDataUser()` → Zod → wrapper DB.
 * Hanya Bersama: ruang Pribadi = `split_shared_only` sebelum menyentuh DB. Dependensi server di-mock
 * (pola `actions.test.ts`); SQL diuji di `server/ledger/__int__/patungan.int.test.ts`.
 */

const POOLS = { auth: {}, app: {} };
const USER_ID = '11111111-1111-4111-8111-111111111111';
const SPACE_ID = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const m = vi.hoisted(() => ({
  requireDataUser: vi.fn(),
  resolveSpace: vi.fn(),
  refresh: vi.fn(),
  createSplit: vi.fn(),
  voidSplit: vi.fn(),
  restoreSplit: vi.fn(),
  settleSplit: vi.fn(),
  voidSettlement: vi.fn(),
  receiveSettlement: vi.fn(),
  voidReceipt: vi.fn(),
  loadPatunganWallets: vi.fn(),
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
vi.mock('@/server/ledger/patungan', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/patungan')>()),
  createSplit: m.createSplit,
  voidSplit: m.voidSplit,
  restoreSplit: m.restoreSplit,
  settleSplit: m.settleSplit,
  voidSettlement: m.voidSettlement,
  receiveSettlement: m.receiveSettlement,
  voidReceipt: m.voidReceipt,
  loadPatunganWallets: m.loadPatunganWallets,
}));

const patungan = await import('./patungan');

type AnyAction = (ruang: unknown, input?: unknown) => Promise<unknown>;
const ACTIONS = patungan as unknown as Record<string, AnyAction>;

const CASES: Record<string, { input?: unknown; wrapper: keyof typeof m; mutation: boolean }> = {
  createSplitAction: {
    input: { clientId: A, accountId: B, amount: 400_000, categoryId: C },
    wrapper: 'createSplit',
    mutation: true,
  },
  voidSplitAction: { input: { clientId: A, splitId: B }, wrapper: 'voidSplit', mutation: true },
  restoreSplitAction: {
    input: { clientId: A, splitId: B },
    wrapper: 'restoreSplit',
    mutation: true,
  },
  settleSplitAction: {
    input: { clientId: A, accountId: B, amount: 200_000 },
    wrapper: 'settleSplit',
    mutation: true,
  },
  voidSettlementAction: {
    input: { clientId: A, settlementId: B },
    wrapper: 'voidSettlement',
    mutation: true,
  },
  receiveSettlementAction: {
    input: { clientId: A, settlementId: B, accountId: C },
    wrapper: 'receiveSettlement',
    mutation: true,
  },
  voidReceiptAction: {
    input: { clientId: A, settlementId: B, allowNegative: true },
    wrapper: 'voidReceipt',
    mutation: true,
  },
  patunganWalletsAction: { wrapper: 'loadPatunganWallets', mutation: false },
};
const NAMES = Object.keys(CASES);
const WRAPPERS = [
  'createSplit',
  'voidSplit',
  'restoreSplit',
  'settleSplit',
  'voidSettlement',
  'receiveSettlement',
  'voidReceipt',
  'loadPatunganWallets',
] as const;

function call(name: string, ruang: unknown = 'bersama', input?: unknown): Promise<unknown> {
  const action = ACTIONS[name];
  const c = CASES[name];
  if (!action || !c) throw new Error(`action ${name} tidak dikenal`);
  return action(ruang, input ?? c.input);
}

beforeEach(() => {
  m.requireDataUser.mockResolvedValue({ userId: USER_ID });
  m.resolveSpace.mockResolvedValue({ spaceId: SPACE_ID, kind: 'shared' });
  for (const w of WRAPPERS) m[w].mockResolvedValue({ ok: 1 });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('daftar action patungan', () => {
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
    expect(m.resolveSpace).toHaveBeenCalledWith(POOLS, USER_ID, 'bersama');
  });

  it.each(NAMES)('redirect sesi diteruskan: %s', async (name) => {
    m.requireDataUser.mockImplementation(() => redirect('/masuk'));
    await expect(call(name)).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT') as unknown,
    });
    for (const w of WRAPPERS) expect(m[w]).not.toHaveBeenCalled();
  });

  it.each(NAMES)('Pribadi = split_shared_only tanpa menyentuh wrapper: %s', async (name) => {
    m.resolveSpace.mockResolvedValue({ spaceId: SPACE_ID, kind: 'personal' });
    await expect(call(name, 'pribadi')).resolves.toEqual({
      ok: false,
      error: { code: 'split_shared_only' },
    });
    for (const w of WRAPPERS) expect(m[w]).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it.each(NAMES)('refresh hanya sesudah tulis berhasil: %s', async (name) => {
    const c = CASES[name];
    await call(name);
    expect(m.refresh).toHaveBeenCalledTimes(c?.mutation === true ? 1 : 0);
  });
});

describe('input', () => {
  it('nominal tidak sah ditolak sebelum DB sebagai invalid di kolomnya', async () => {
    await expect(
      call('settleSplitAction', 'bersama', { clientId: A, accountId: B, amount: 0 }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'amount' } });
    expect(m.settleSplit).not.toHaveBeenCalled();
  });

  it('bagian lebih dari dua anggota ditolak', async () => {
    const r = await call('createSplitAction', 'bersama', {
      clientId: A,
      accountId: B,
      amount: 3,
      categoryId: C,
      shares: [
        { userId: A, amount: 1 },
        { userId: B, amount: 1 },
        { userId: C, amount: 1 },
      ],
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(m.createSplit).not.toHaveBeenCalled();
  });

  it('galat DB DK422 dipetakan ke kode, tanpa nominal', async () => {
    m.settleSplit.mockRejectedValue(Object.assign(new Error('payment_exceeds'), { code: 'DK422' }));
    await expect(call('settleSplitAction')).resolves.toEqual({
      ok: false,
      error: { code: 'payment_exceeds' },
    });
    m.voidSettlement.mockRejectedValue(
      Object.assign(new Error('settlement_received'), { code: 'DK422' }),
    );
    await expect(call('voidSettlementAction')).resolves.toEqual({
      ok: false,
      error: { code: 'settlement_received' },
    });
  });
});
