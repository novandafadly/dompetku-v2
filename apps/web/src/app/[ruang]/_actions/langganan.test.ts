import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  actionContext: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
  dismissSubscription: vi.fn<(...a: unknown[]) => Promise<{ dismissed: boolean }>>(),
  refresh: vi.fn(),
}));

vi.mock('next/cache', () => ({ refresh: mocks.refresh }));
vi.mock('@/server/ledger/langganan', async () => {
  const actual = await vi.importActual<typeof import('@/server/ledger/langganan')>(
    '@/server/ledger/langganan',
  );
  return {
    dismissSubscriptionSchema: actual.dismissSubscriptionSchema,
    dismissSubscription: (...a: unknown[]) => mocks.dismissSubscription(...a),
  };
});
vi.mock('./context', async () => {
  const actual = await vi.importActual<typeof import('./context')>('./context');
  return {
    ...actual,
    actionContext: (...a: unknown[]) => mocks.actionContext(...a),
  };
});

import { dismissSubscriptionAction } from './langganan';

beforeEach(() => {
  mocks.actionContext.mockReset();
  mocks.dismissSubscription.mockReset();
  mocks.refresh.mockReset();
  mocks.actionContext.mockResolvedValue({
    ruang: 'pribadi',
    userId: 'u1',
    spaceId: 's1',
    kind: 'personal',
    pools: {},
  });
  mocks.dismissSubscription.mockResolvedValue({ dismissed: true });
});

describe('dismissSubscriptionAction (S16)', () => {
  it('meneruskan input bersih ke dismissSubscription lalu memanggil refresh', async () => {
    const res = await dismissSubscriptionAction('pribadi', { name: '  Netflix ', amount: 54_000 });
    expect(res).toEqual({ ok: true, value: { dismissed: true } });
    expect(mocks.dismissSubscription).toHaveBeenCalledWith(expect.anything(), {
      name: 'Netflix',
      amount: 54_000,
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('menolak nama kosong atau nominal <= 0 sebelum menyentuh DB', async () => {
    const r1 = await dismissSubscriptionAction('pribadi', { name: '   ', amount: 54_000 });
    expect(r1.ok).toBe(false);
    const r2 = await dismissSubscriptionAction('pribadi', { name: 'Netflix', amount: 0 });
    expect(r2.ok).toBe(false);
    expect(mocks.dismissSubscription).not.toHaveBeenCalled();
  });
});
