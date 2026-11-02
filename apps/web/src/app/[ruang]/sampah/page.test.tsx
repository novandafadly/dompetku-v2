import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SampahFailed, SampahReal } from '../_real/sampah';
import Page from './page';
import { SampahPage } from './view';

/**
 * Page Sampah: prototipe tidak menyentuh auth/DB; mode nyata memanggil gerbang (`ruangContext`)
 * sebelum loader, memakai konteks ruang itu saja, dan galat loader menjadi layar gagal muat.
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
vi.mock('@/server/ledger/sampah', () => ({
  loadSampah: (...a: unknown[]): unknown => {
    h.order.push('loader');
    return h.load(...a);
  },
}));
vi.mock('./view', () => ({ SampahPage: () => null }));
vi.mock('../_real/sampah', () => ({ SampahReal: () => null, SampahFailed: () => null }));

const CTX = { pools: {}, userId: 'u', spaceId: 's', ruang: 'bersama', kind: 'shared' };
const DATA = { items: [], accounts: [] };

async function run(sp: Record<string, string | string[] | undefined> = {}): Promise<ReactElement> {
  const el: unknown = await Page({
    params: Promise.resolve({ ruang: 'bersama' }),
    searchParams: Promise.resolve(sp),
  });
  if (!isValidElement(el)) throw new Error('bukan elemen');
  return el;
}

const props = (el: ReactElement) => el.props as Record<string, unknown>;

beforeEach(() => {
  // 31 Okt 2026 23:30 WIB = 16:30 UTC: tanggal WIB, bukan UTC.
  vi.useFakeTimers({ now: new Date('2026-10-31T16:30:00Z'), toFake: ['Date'] });
  h.prototype = false;
  h.order = [];
  h.ctx.mockResolvedValue(CTX);
  h.load.mockResolvedValue(DATA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('page Sampah', () => {
  it('prototipe: view demo, tanpa gerbang dan tanpa loader', async () => {
    h.prototype = true;
    const el = await run();
    expect(el.type).toBe(SampahPage);
    expect(h.ctx).not.toHaveBeenCalled();
    expect(h.load).not.toHaveBeenCalled();
  });

  it('nyata: gerbang dulu, lalu loader dengan konteks ruang itu; today WIB; tautan kembali', async () => {
    const el = await run({ theme: 'light', today: '2020-01-01', seed: 'full' });
    expect(h.order).toEqual(['gerbang', 'loader']);
    expect(h.load).toHaveBeenCalledWith(CTX);
    expect(el.type).toBe(SampahReal);
    // Hanya `theme` yang terbawa di mode nyata; tanggal dari server (WIB), bukan query.
    expect(props(el)).toEqual({
      ruang: 'bersama',
      today: '2026-10-31',
      backHref: '/bersama/transaksi?theme=light',
      data: DATA,
    });
  });

  it('galat loader = layar gagal muat (bukan 500)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.load.mockRejectedValue(new Error('detail rahasia: Rp 12345'));
    const el = await run();
    expect(el.type).toBe(SampahFailed);
    expect(props(el)).toEqual({ ruang: 'bersama', backHref: '/bersama/transaksi' });
    // Log tidak memuat pesan galat (bisa memuat data).
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('rahasia');
  });
});
