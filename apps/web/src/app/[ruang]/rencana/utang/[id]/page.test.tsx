import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UtangDetailFailed } from '../../../_real/utang';
import { UtangDetailHosted } from '../../../_real/utang-section';
import Page from './page';

/**
 * Page detail utang (S11-DT1): hanya mode nyata dan Pribadi (B10). Gerbang lebih dulu, Bersama =
 * 404 sebelum loader, utang tak ada/terhapus (loader `null`) = 404, galat loader = layar gagal muat.
 */

const h = vi.hoisted(() => ({
  prototype: false,
  detail: vi.fn(),
  kontak: vi.fn(),
  accounts: vi.fn(),
  ctx: vi.fn(),
  order: [] as string[],
}));

vi.mock('@/server/env', () => ({ isPrototype: () => h.prototype }));
vi.mock('../../../_real/context', () => ({
  ruangContext: (...a: unknown[]): unknown => {
    h.order.push('gerbang');
    return h.ctx(...a);
  },
  ruangAccounts: (...a: unknown[]): unknown => {
    h.order.push('dompet');
    return h.accounts(...a);
  },
}));
vi.mock('@/server/ledger/utang', () => ({
  loadDebtDetail: (...a: unknown[]): unknown => {
    h.order.push('detail');
    return h.detail(...a);
  },
  loadKontak: (...a: unknown[]): unknown => {
    h.order.push('kontak');
    return h.kontak(...a);
  },
}));
vi.mock('../../../_real/utang', () => ({ UtangDetailFailed: () => null }));
vi.mock('../../../_real/utang-section', () => ({ UtangDetailHosted: () => null }));

const PRIBADI = { pools: {}, userId: 'u', spaceId: 's', ruang: 'pribadi', kind: 'personal' };
const BERSAMA = { ...PRIBADI, ruang: 'bersama', kind: 'shared' };
const DETAIL = { debtId: 'd1', contactName: 'Budi' };

async function run(
  ruang = 'pribadi',
  sp: Record<string, string | string[] | undefined> = {},
): Promise<ReactElement> {
  const el: unknown = await Page({
    params: Promise.resolve({ ruang, id: 'd1' }),
    searchParams: Promise.resolve(sp),
  });
  if (!isValidElement(el)) throw new Error('bukan elemen');
  return el;
}

beforeEach(() => {
  h.prototype = false;
  h.order = [];
  h.ctx.mockResolvedValue(PRIBADI);
  h.detail.mockResolvedValue(DETAIL);
  h.kontak.mockResolvedValue([]);
  h.accounts.mockResolvedValue([]);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('page detail utang', () => {
  it('prototipe = 404 tanpa gerbang dan tanpa loader', async () => {
    h.prototype = true;
    await expect(run()).rejects.toThrow();
    expect(h.ctx).not.toHaveBeenCalled();
    expect(h.detail).not.toHaveBeenCalled();
  });

  it('nyata Pribadi: gerbang dulu, loader dengan konteks dan id; hanya theme terbawa', async () => {
    const el = await run('pribadi', { theme: 'light', seed: 'full' });
    expect(h.order[0]).toBe('gerbang');
    expect(h.detail).toHaveBeenCalledWith(PRIBADI, 'd1');
    expect(h.kontak).toHaveBeenCalledWith(PRIBADI);
    expect(el.type).toBe(UtangDetailHosted);
    expect(el.props).toMatchObject({ ruang: 'pribadi', query: '?theme=light', detail: DETAIL });
  });

  it('Bersama = 404 sesudah gerbang dan SEBELUM loader apa pun (B10)', async () => {
    h.ctx.mockResolvedValue(BERSAMA);
    await expect(run('bersama')).rejects.toThrow();
    expect(h.order).toEqual(['gerbang']);
  });

  it('utang tidak ada, milik ruang lain, atau sudah dihapus (loader null) = 404', async () => {
    h.detail.mockResolvedValue(null);
    await expect(run()).rejects.toThrow();
  });

  it('galat loader = layar gagal muat; log tanpa pesan galat', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.detail.mockRejectedValue(new Error('detail rahasia: Rp 12345'));
    const el = await run('pribadi', { theme: 'dark' });
    expect(el.type).toBe(UtangDetailFailed);
    expect(el.props).toEqual({ ruang: 'pribadi', query: '?theme=dark' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('rahasia');
  });
});
