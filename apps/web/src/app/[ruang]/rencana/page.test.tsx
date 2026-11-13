import { isValidElement, Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RencanaFailed, RencanaReal } from '../_real/rencana';
import { UtangSection } from '../_real/utang-section';
import Page from './page';
import { RencanaPage } from './view';

/**
 * Page Rencana: cabang `?bagian=utang` (S11). Utang hanya di Pribadi mode nyata; di Bersama (dan
 * prototipe) `bagian=utang` jatuh ke Anggaran tanpa memuat apa pun dari Utang. Utang dimuat per
 * bagian (`UtangSection`), terpisah dari `loadRencana`.
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
  ruangShell: () => ({}),
}));
vi.mock('@/server/ledger/rencana', () => ({
  loadRencana: (...a: unknown[]): unknown => {
    h.order.push('loadRencana');
    return h.load(...a);
  },
}));
vi.mock('./view', () => ({ RencanaPage: () => null }));
vi.mock('../_real/rencana', () => ({ RencanaReal: () => null, RencanaFailed: () => null }));
vi.mock('../_real/utang-section', () => ({ UtangSection: () => null }));
vi.mock('../_real/utang', () => ({ UtangLoading: () => null }));

const PRIBADI = { pools: {}, userId: 'u', spaceId: 's', ruang: 'pribadi', kind: 'personal' };
const BERSAMA = { ...PRIBADI, ruang: 'bersama', kind: 'shared' };

async function run(
  sp: Record<string, string | string[] | undefined>,
  ruang = 'pribadi',
): Promise<ReactElement> {
  const el: unknown = await Page({
    params: Promise.resolve({ ruang }),
    searchParams: Promise.resolve(sp),
  });
  if (!isValidElement(el)) throw new Error('bukan elemen');
  return el;
}

beforeEach(() => {
  h.prototype = false;
  h.order = [];
  h.ctx.mockResolvedValue(PRIBADI);
  h.load.mockResolvedValue({ period: {} });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('page Rencana: bagian=utang', () => {
  it('Pribadi nyata: gerbang dulu, lalu UtangSection di Suspense; loadRencana tidak dipanggil', async () => {
    const el = await run({ bagian: 'utang', theme: 'light' });
    expect(h.order).toEqual(['gerbang']);
    expect(h.load).not.toHaveBeenCalled();
    expect(el.type).toBe(Suspense);
    const child = (el.props as { children: ReactElement }).children;
    expect(child.type).toBe(UtangSection);
    expect(child.props).toEqual({ ctx: PRIBADI, query: '?theme=light' });
  });

  it('Bersama nyata: bagian=utang jatuh ke Anggaran, tanpa UtangSection', async () => {
    h.ctx.mockResolvedValue(BERSAMA);
    const el = await run({ bagian: 'utang' }, 'bersama');
    expect(h.order).toEqual(['gerbang', 'loadRencana']);
    expect(el.type).toBe(RencanaReal);
    expect(el.props).toMatchObject({ ruang: 'bersama', bagian: 'anggaran' });
  });

  it('prototipe: keadaan kosong tetap, tanpa gerbang dan tanpa loader', async () => {
    h.prototype = true;
    const el = await run({ bagian: 'utang' });
    expect(el.type).toBe(RencanaPage);
    expect(h.ctx).not.toHaveBeenCalled();
  });

  it('Anggaran/Tagihan Pribadi tidak terpengaruh: loadRencana + bagian sesuai', async () => {
    const el = await run({ bagian: 'tagihan' });
    expect(h.order).toEqual(['gerbang', 'loadRencana']);
    expect(el.props).toMatchObject({ bagian: 'tagihan' });
  });

  it('galat loadRencana = RencanaFailed (bukan 500)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.load.mockRejectedValue(new Error('x'));
    const el = await run({});
    expect(el.type).toBe(RencanaFailed);
  });
});
