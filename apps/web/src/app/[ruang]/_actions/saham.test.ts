import { redirect } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server Action Saham (S14 Task 10): endpoint publik, gerbang `requireDataUser()` → Zod → wrapper DB.
 * Dependensi server di-mock (pola `aset.test.ts`); SQL diuji di
 * `server/ledger/__int__/saham.int.test.ts`.
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
  buyStock: vi.fn(),
  sellStock: vi.fn(),
  openStockHolding: vi.fn(),
  previewSell: vi.fn(),
  setStockPrice: vi.fn(),
  voidStockTrade: vi.fn(),
  restoreStockTrade: vi.fn(),
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
vi.mock('@/server/ledger/saham', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/saham')>()),
  buyStock: m.buyStock,
  sellStock: m.sellStock,
  openStockHolding: m.openStockHolding,
  previewSell: m.previewSell,
  setStockPrice: m.setStockPrice,
  voidStockTrade: m.voidStockTrade,
  restoreStockTrade: m.restoreStockTrade,
}));

const saham = await import('./saham');

type AnyAction = (ruang: unknown, input?: unknown) => Promise<unknown>;
const ACTIONS = saham as unknown as Record<string, AnyAction>;

type Wrapper =
  | 'buyStock'
  | 'sellStock'
  | 'openStockHolding'
  | 'previewSell'
  | 'setStockPrice'
  | 'voidStockTrade'
  | 'restoreStockTrade';
const CASES: Record<string, { input: unknown; wrapper: Wrapper; refresh: boolean }> = {
  buyStockAction: {
    input: {
      clientId: A,
      accountId: B,
      ticker: 'BBCA',
      shares: 200,
      price: 9150,
      fromAccountId: C,
    },
    wrapper: 'buyStock',
    refresh: true,
  },
  sellStockAction: {
    input: {
      clientId: A,
      accountId: B,
      ticker: 'BBCA',
      shares: 100,
      price: 9800,
      toAccountId: C,
    },
    wrapper: 'sellStock',
    refresh: true,
  },
  openStockHoldingAction: {
    input: { clientId: A, accountId: B, ticker: 'BBCA', shares: 250, price: 9000 },
    wrapper: 'openStockHolding',
    refresh: true,
  },
  previewSellAction: {
    input: { accountId: B, ticker: 'BBCA', shares: 100, price: 9800 },
    wrapper: 'previewSell',
    refresh: false,
  },
  setStockPriceAction: {
    input: { clientId: A, ticker: 'BBCA', close: 9800 },
    wrapper: 'setStockPrice',
    refresh: true,
  },
  voidStockTradeAction: {
    input: { clientId: A, tradeId: B },
    wrapper: 'voidStockTrade',
    refresh: true,
  },
  restoreStockTradeAction: {
    input: { clientId: A, tradeId: B },
    wrapper: 'restoreStockTrade',
    refresh: true,
  },
};
const NAMES = Object.keys(CASES);
const WRAPPERS = Object.values(CASES).map((c) => c.wrapper);

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

describe('daftar action saham', () => {
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

  it.each(NAMES)('refresh hanya sesudah tulis sukses: %s', async (name) => {
    await expect(call(name)).resolves.toEqual({ ok: true, value: { ok: 1 } });
    expect(m.refresh).toHaveBeenCalledTimes(CASES[name]?.refresh === true ? 1 : 0);
  });
});

describe('input', () => {
  it('kode saham bukan 4 huruf kapital, lembar/harga tidak sah ditolak sebelum DB', async () => {
    const buy = CASES.buyStockAction?.input as Record<string, unknown>;
    for (const [bad, field] of [
      [{ ticker: 'bbca' }, 'ticker'],
      [{ ticker: 'BBCA.JK' }, 'ticker'],
      [{ shares: 0 }, 'shares'],
      [{ shares: 1.5 }, 'shares'],
      [{ price: 0 }, 'price'],
      [{ price: 10 ** 9 + 1 }, 'price'],
      [{ fee: -1 }, 'fee'],
      [{ on: 'kemarin' }, 'on'],
    ] as const) {
      await expect(call('buyStockAction', 'pribadi', { ...buy, ...bad })).resolves.toEqual({
        ok: false,
        error: { code: 'invalid', field },
      });
    }
    await expect(
      call('setStockPriceAction', 'pribadi', { clientId: A, ticker: 'BBCA', close: 0 }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'close' } });
    expect(m.buyStock).not.toHaveBeenCalled();
    expect(m.setStockPrice).not.toHaveBeenCalled();
  });

  it('galat DB dipetakan ke kode tanpa nominal atau kode saham', async () => {
    for (const rule of [
      'insufficient_shares',
      'saldo_negatif',
      'before_latest_entry',
      'account_has_holdings',
    ] as const) {
      m.sellStock.mockRejectedValueOnce(Object.assign(new Error(rule), { code: 'DK422' }));
      await expect(call('sellStockAction')).resolves.toEqual({ ok: false, error: { code: rule } });
    }
    m.setStockPrice.mockRejectedValue(
      Object.assign(new Error('price_spike_unconfirmed'), { code: 'DK422' }),
    );
    await expect(call('setStockPriceAction')).resolves.toEqual({
      ok: false,
      error: { code: 'price_spike_unconfirmed' },
    });
    m.voidStockTrade.mockRejectedValue(
      Object.assign(new Error('trade_not_latest'), { code: 'DK422' }),
    );
    await expect(call('voidStockTradeAction')).resolves.toEqual({
      ok: false,
      error: { code: 'trade_not_latest' },
    });
    m.previewSell.mockRejectedValue(
      Object.assign(new Error('holding_not_found'), { code: 'DK404' }),
    );
    await expect(call('previewSellAction')).resolves.toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
