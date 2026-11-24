import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParseEntryResult } from '@/server/ai/parse-entry';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  actionContext: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
  parseFreeTextEntry: vi.fn<(...a: unknown[]) => Promise<ParseEntryResult>>(),
  refresh: vi.fn(),
}));

vi.mock('next/cache', () => ({ refresh: mocks.refresh }));
vi.mock('@/server/ai/parse-entry', () => ({
  parseFreeTextEntry: (...a: unknown[]) => mocks.parseFreeTextEntry(...a),
}));
vi.mock('./context', async () => {
  const actual = await vi.importActual<typeof import('./context')>('./context');
  return {
    ...actual,
    actionContext: (...a: unknown[]) => mocks.actionContext(...a),
  };
});

import { parseFreeTextAction } from './catat-ai';

beforeEach(() => {
  mocks.actionContext.mockReset();
  mocks.parseFreeTextEntry.mockReset();
  mocks.refresh.mockReset();
  mocks.actionContext.mockResolvedValue({
    ruang: 'pribadi',
    userId: 'u1',
    spaceId: 's1',
    kind: 'personal',
    pools: {},
  });
  mocks.parseFreeTextEntry.mockResolvedValue({
    ok: true,
    preview: {
      type: 'expense',
      amount: 35_000,
      description: 'makan siang',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      occurredOn: null,
      source: 'rules',
    },
  });
});

describe('parseFreeTextAction (S17)', () => {
  it('meneruskan teks bersih ke parseFreeTextEntry tanpa memanggil refresh (baca-saja)', async () => {
    const res = await parseFreeTextAction('pribadi', { text: '  makan siang 35rb bca  ' });
    expect(res.ok).toBe(true);
    expect(mocks.parseFreeTextEntry).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', spaceId: 's1' }),
      'makan siang 35rb bca',
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('menolak teks kosong atau > 300 huruf sebelum menyentuh DB', async () => {
    const r1 = await parseFreeTextAction('pribadi', { text: '   ' });
    expect(r1).toEqual({ ok: false, error: { code: 'invalid', field: 'text' } });
    const r2 = await parseFreeTextAction('pribadi', { text: 'a'.repeat(301) });
    expect(r2).toEqual({ ok: false, error: { code: 'invalid', field: 'text' } });
    expect(mocks.parseFreeTextEntry).not.toHaveBeenCalled();
  });
});
