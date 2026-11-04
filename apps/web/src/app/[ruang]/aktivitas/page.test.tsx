import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeCursor } from '@/server/ledger/bersama';
import { AktivitasFailed, AktivitasReal } from '../_real/aktivitas';
import Page from './page';
import { AktivitasPage } from './view';

/**
 * Page Aktivitas (K5): prototipe = view demo; nyata = gerbang (`ruangContext`) lalu loader. Hanya
 * ruang Bersama (Pribadi = 404), kursor `?sebelum=` rusak = halaman pertama, galat loader = layar
 * gagal muat (bukan 500).
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
vi.mock('@/server/ledger/bersama', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/bersama')>()),
  loadAktivitas: (...a: unknown[]): unknown => {
    h.order.push('loader');
    return h.load(...a);
  },
}));
vi.mock('./view', () => ({ AktivitasPage: () => null }));
vi.mock('../_real/aktivitas', () => ({ AktivitasReal: () => null, AktivitasFailed: () => null }));

const CTX = { pools: {}, userId: 'u', spaceId: 's', ruang: 'bersama', kind: 'shared' };
const CUR = {
  at: '2026-11-04T02:15:00.123456Z',
  entryId: '0190a7a0-0000-7000-8000-000000000001',
  version: 2,
};
const ENC = encodeCursor(CUR);

async function run(
  sp: Record<string, string | string[] | undefined> = {},
  ruang = 'bersama',
): Promise<ReactElement> {
  const el: unknown = await Page({
    params: Promise.resolve({ ruang }),
    searchParams: Promise.resolve(sp),
  });
  if (!isValidElement(el)) throw new Error('bukan elemen');
  return el;
}
const props = (el: ReactElement) => el.props as Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-04T10:00:00Z'), toFake: ['Date'] });
  h.prototype = false;
  h.order = [];
  h.ctx.mockResolvedValue(CTX);
  h.load.mockResolvedValue({ items: [], next: null, partner: { name: 'Farida', initial: 'F' } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('page Aktivitas', () => {
  it('prototipe: view demo, tanpa gerbang dan tanpa loader (tidak 404)', async () => {
    h.prototype = true;
    const el = await run({}, 'pribadi');
    expect(el.type).toBe(AktivitasPage);
    expect(h.ctx).not.toHaveBeenCalled();
    expect(h.load).not.toHaveBeenCalled();
  });

  it('nyata: gerbang dulu, lalu loader tanpa kursor; hanya theme terbawa', async () => {
    const el = await run({ theme: 'light', seed: 'full' });
    expect(h.order).toEqual(['gerbang', 'loader']);
    expect(h.load).toHaveBeenCalledWith(CTX, { before: null });
    expect(el.type).toBe(AktivitasReal);
    expect(props(el)).toMatchObject({
      today: '2026-11-04',
      query: '?theme=light',
      backHref: '/bersama/beranda?theme=light',
      newestHref: null,
      olderHref: null,
      partnerName: 'Farida',
      items: [],
    });
  });

  it('kursor sah: dipakai loader; Kembali ke terbaru tanpa kursor; Muat sebelumnya dari next', async () => {
    const next = { ...CUR, version: 1 };
    h.load.mockResolvedValue({
      items: [{ key: 'a', href: null }],
      next,
      partner: { name: 'Farida', initial: 'F' },
    });
    const el = await run({ theme: 'dark', sebelum: ENC });
    expect(h.load).toHaveBeenCalledWith(CTX, { before: CUR });
    expect(props(el)).toMatchObject({
      newestHref: '/bersama/aktivitas?theme=dark',
      olderHref: `/bersama/aktivitas?theme=dark&sebelum=${encodeCursor(next)}`,
    });
  });

  it('kursor rusak = halaman pertama (bukan 404/500)', async () => {
    const el = await run({ sebelum: 'rusak!!' });
    expect(h.load).toHaveBeenCalledWith(CTX, { before: null });
    expect(props(el)).toMatchObject({ newestHref: null });
  });

  it('items kosong + next: tanpa olderHref (tidak ada tautan mati)', async () => {
    h.load.mockResolvedValue({ items: [], next: CUR, partner: null });
    const el = await run();
    expect(props(el)).toMatchObject({ olderHref: null, partnerName: null });
  });

  it('/pribadi/aktivitas = 404 sebelum loader', async () => {
    h.ctx.mockResolvedValue({ ...CTX, ruang: 'pribadi', kind: 'personal' });
    await expect(run({}, 'pribadi')).rejects.toThrow();
    expect(h.load).not.toHaveBeenCalled();
  });

  it('galat loader = layar gagal muat dengan Coba lagi ke URL yang sama; log tanpa pesan galat', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.load.mockRejectedValue(new Error('detail rahasia: Rp 12345'));
    const el = await run({ theme: 'light', sebelum: ENC });
    expect(el.type).toBe(AktivitasFailed);
    expect(props(el)).toEqual({
      backHref: '/bersama/beranda?theme=light',
      retryHref: `/bersama/aktivitas?theme=light&sebelum=${ENC}`,
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('rahasia');
  });
});
