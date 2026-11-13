import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KontakFailed, KontakReal } from '../_real/kontak';
import Page from './page';

/**
 * Page Kontak (S11-KT1): hanya mode nyata dan ruang Pribadi. Gerbang (`ruangContext` =
 * `requireDataUser`) selalu lebih dulu; Bersama = 404 sebelum loader; galat loader = layar gagal muat.
 */

const h = vi.hoisted(() => ({
  prototype: false,
  load: vi.fn(),
  ctx: vi.fn(),
  order: [] as string[],
}));

vi.mock('@/server/env', () => ({ isPrototype: () => h.prototype }));
vi.mock('../_real/context', () => ({
  ruangContext: (...a: unknown[]): unknown => {
    h.order.push('gerbang');
    return h.ctx(...a);
  },
}));
vi.mock('@/server/ledger/utang', () => ({
  loadKontak: (...a: unknown[]): unknown => {
    h.order.push('loader');
    return h.load(...a);
  },
}));
vi.mock('../_real/kontak', () => ({ KontakReal: () => null, KontakFailed: () => null }));

const PRIBADI = { pools: {}, userId: 'u', spaceId: 's', ruang: 'pribadi', kind: 'personal' };
const BERSAMA = { ...PRIBADI, ruang: 'bersama', kind: 'shared' };

async function run(ruang = 'pribadi'): Promise<ReactElement> {
  const el: unknown = await Page({ params: Promise.resolve({ ruang }) });
  if (!isValidElement(el)) throw new Error('bukan elemen');
  return el;
}

beforeEach(() => {
  h.prototype = false;
  h.order = [];
  h.ctx.mockResolvedValue(PRIBADI);
  h.load.mockResolvedValue([]);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('page Kontak', () => {
  it('prototipe = 404 tanpa gerbang dan tanpa loader (Menu tetap Segera)', async () => {
    h.prototype = true;
    await expect(run()).rejects.toThrow();
    expect(h.ctx).not.toHaveBeenCalled();
    expect(h.load).not.toHaveBeenCalled();
  });

  it('nyata Pribadi: gerbang dulu, lalu loader dengan konteks yang sama', async () => {
    const contacts = [{ contactId: 'c1', name: 'Budi' }];
    h.load.mockResolvedValue(contacts);
    const el = await run();
    expect(h.order).toEqual(['gerbang', 'loader']);
    expect(h.load).toHaveBeenCalledWith(PRIBADI);
    expect(el.type).toBe(KontakReal);
    expect(el.props).toEqual({ ruang: 'pribadi', contacts });
  });

  it('Bersama = 404 sesudah gerbang dan SEBELUM loader', async () => {
    h.ctx.mockResolvedValue(BERSAMA);
    await expect(run('bersama')).rejects.toThrow();
    expect(h.order).toEqual(['gerbang']);
    expect(h.load).not.toHaveBeenCalled();
  });

  it('galat loader = layar gagal muat; log tanpa pesan galat', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.load.mockRejectedValue(new Error('detail rahasia: Rp 12345'));
    const el = await run();
    expect(el.type).toBe(KontakFailed);
    expect(el.props).toEqual({ ruang: 'pribadi' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('rahasia');
  });
});
