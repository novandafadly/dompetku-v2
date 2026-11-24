import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  prototype: false,
  order: [] as string[],
  loadKalender: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
}));

vi.mock('@/server/env', () => ({ isPrototype: () => h.prototype }));
vi.mock('../../_real/context', () => ({
  ruangContext: () => {
    h.order.push('gerbang');
    return Promise.resolve({
      ruang: 'pribadi',
      userId: 'u1',
      spaceId: 's1',
      kind: 'personal',
      pools: {},
    });
  },
}));
vi.mock('@/server/ledger/kalender', async () => {
  const actual = await vi.importActual<typeof import('@/server/ledger/kalender')>(
    '@/server/ledger/kalender',
  );
  return {
    parseKalenderDays: actual.parseKalenderDays,
    loadKalender: (...a: unknown[]) => {
      h.order.push('loadKalender');
      return h.loadKalender(...a);
    },
  };
});

import Page from './page';

beforeEach(() => {
  h.prototype = false;
  h.order.length = 0;
  h.loadKalender.mockReset();
  h.loadKalender.mockResolvedValue({
    daysWindow: 30,
    today: '2027-03-10',
    startBalance: 1_000_000,
    lowestBalance: 1_000_000,
    lowestDay: '2027-03-10',
    firstShortDay: null,
    totalBillsCount: 0,
    totalBillsAmount: 0,
    days: [],
  });
});

describe('page /[ruang]/rencana/kalender', () => {
  it('prototipe = 404 tanpa memanggil gerbang atau loader', async () => {
    h.prototype = true;
    await expect(
      Page({ params: Promise.resolve({ ruang: 'pribadi' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow();
    expect(h.order).toEqual([]);
  });

  it('mode nyata: gerbang dulu lalu loadKalender; ?hari=90 diteruskan, nilai asing = 30', async () => {
    await Page({
      params: Promise.resolve({ ruang: 'pribadi' }),
      searchParams: Promise.resolve({ hari: '90' }),
    });
    expect(h.order).toEqual(['gerbang', 'loadKalender']);
    expect(h.loadKalender).toHaveBeenCalledWith(expect.anything(), 90);

    await Page({
      params: Promise.resolve({ ruang: 'pribadi' }),
      searchParams: Promise.resolve({ hari: '999' }),
    });
    expect(h.loadKalender).toHaveBeenLastCalledWith(expect.anything(), 30);
  });

  it('galat loader = KalenderFailed, bukan 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.loadKalender.mockRejectedValueOnce(new Error('putus'));
    const el = await Page({
      params: Promise.resolve({ ruang: 'pribadi' }),
      searchParams: Promise.resolve({}),
    });
    expect(el.type).toBeDefined();
    spy.mockRestore();
  });
});
