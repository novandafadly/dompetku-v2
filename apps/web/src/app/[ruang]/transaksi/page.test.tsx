import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransaksiFailed, TransaksiReal } from '../_real/transaksi';
import Page from './page';

/**
 * Page Transaksi mode nyata: `?bulan=` divalidasi di server (tanpa 500/404), bulan bawaan = bulan
 * WIB `todayWIB()`, dan galat loader dirender sebagai layar gagal muat (bukan 500).
 */

const h = vi.hoisted(() => ({
  prototype: false,
  load: vi.fn(),
  accounts: vi.fn(),
  ctx: vi.fn(),
}));

vi.mock('@/server/env', () => ({ isPrototype: () => h.prototype }));
vi.mock('../_real/context', () => ({ ruangContext: h.ctx, ruangAccounts: h.accounts }));
vi.mock('@/server/ledger/transaksi', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/transaksi')>()),
  loadTransaksi: h.load,
}));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => undefined }));
vi.mock('./view', () => ({ TransaksiPage: () => null }));
vi.mock('../_real/transaksi', () => ({
  TransaksiReal: () => null,
  TransaksiFailed: () => null,
}));

const CTX = { pools: {}, userId: 'u', spaceId: 's', ruang: 'pribadi', kind: 'personal' };
const DATA = {
  entries: [],
  summary: { pemasukan: 0, pengeluaran: 0, selisih: 0, transfer: 0 },
  hasAny: false,
};

async function run(sp: Record<string, string | string[] | undefined>): Promise<ReactElement> {
  const el: unknown = await Page({
    params: Promise.resolve({ ruang: 'pribadi' }),
    searchParams: Promise.resolve(sp),
  });
  if (!isValidElement(el)) throw new Error('bukan elemen');
  return el;
}

const props = (el: ReactElement) => el.props as Record<string, unknown>;

beforeEach(() => {
  // 31 Okt 2026 23:30 WIB = 16:30 UTC: bulan bawaan Oktober (WIB), bukan UTC/zona mesin.
  vi.useFakeTimers({ now: new Date('2026-10-31T16:30:00Z'), toFake: ['Date'] });
  h.prototype = false;
  h.ctx.mockResolvedValue(CTX);
  h.accounts.mockResolvedValue([{ openedOn: '2026-08-20' }, { openedOn: '2026-09-02' }]);
  h.load.mockResolvedValue(DATA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('page Transaksi (nyata)', () => {
  it('tanpa ?bulan= → bulan WIB berjalan', async () => {
    const el = await run({});
    expect(el.type).toBe(TransaksiReal);
    expect(h.load).toHaveBeenCalledWith(CTX, '2026-10');
    expect(props(el)).toMatchObject({
      ruang: 'pribadi',
      today: '2026-10-31',
      month: '2026-10',
      minMonth: '2026-08',
      query: '',
      data: DATA,
    });
  });

  it('?bulan= sah dipakai', async () => {
    const el = await run({ bulan: '2026-09', theme: 'light' });
    expect(h.load).toHaveBeenCalledWith(CTX, '2026-09');
    expect(props(el)).toMatchObject({ month: '2026-09', query: '?theme=light' });
  });

  for (const bad of ['2026-13', 'abc', '2026-1', '', '2026-11', '9999-01']) {
    it(`?bulan=${bad} tidak sah atau masa depan → bulan bawaan`, async () => {
      const el = await run({ bulan: bad });
      expect(el.type).toBe(TransaksiReal);
      expect(h.load).toHaveBeenCalledWith(CTX, '2026-10');
    });
  }

  it('?bulan= ganda → bulan bawaan', async () => {
    await run({ bulan: ['2026-09', '2026-08'] });
    expect(h.load).toHaveBeenCalledWith(CTX, '2026-10');
  });

  it('loader gagal → layar gagal muat, bukan 500', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.load.mockRejectedValue(
      Object.assign(new Error('Rp 50.000 rahasia'), { code: 'ECONNREFUSED' }),
    );
    const el = await run({});
    expect(el.type).toBe(TransaksiFailed);
    // Log hanya kode galat, tanpa pesan (bisa memuat nominal/deskripsi).
    expect(err).toHaveBeenCalledWith('[transaksi] gagal memuat', 'ECONNREFUSED');
    expect(JSON.stringify(err.mock.calls)).not.toContain('50.000');
    err.mockRestore();
  });

  it('gerbang dan resolve ruang tetap melempar (redirect/404 bukan gagal muat)', async () => {
    const boom = new Error('NEXT_NOT_FOUND');
    h.ctx.mockRejectedValue(boom);
    await expect(run({})).rejects.toBe(boom);
    expect(h.load).not.toHaveBeenCalled();
  });

  it('prototipe: tanpa gerbang dan tanpa loader', async () => {
    h.prototype = true;
    await run({});
    expect(h.ctx).not.toHaveBeenCalled();
    expect(h.load).not.toHaveBeenCalled();
  });
});
