// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  requireDataUser: vi.fn(),
  resolveSpace: vi.fn(),
  runAiAnalysis: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/server/auth/next', () => ({
  requireDataUser: m.requireDataUser,
  authService: () => ({ pools: { auth: {}, app: {} } }),
}));
vi.mock('next/cache', () => ({ refresh: m.refresh }));
vi.mock('@/server/ledger/space', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/space')>()),
  resolveSpace: m.resolveSpace,
}));
vi.mock('@/server/ai/analyze', () => ({
  runAiAnalysis: m.runAiAnalysis,
}));

import { runAnalysisAction } from './analisis';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SPACE_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  m.requireDataUser.mockResolvedValue({ userId: USER_ID });
  m.resolveSpace.mockResolvedValue({ spaceId: SPACE_ID, kind: 'personal' });
});

describe('runAnalysisAction (S18)', () => {
  it('meneruskan periode sah dan kind ruang ke runAiAnalysis tanpa memanggil refresh', async () => {
    m.runAiAnalysis.mockResolvedValueOnce({
      ok: true,
      analysis: {
        ringkasan: 'Pengeluaran terjaga dengan baik.',
        sorotan: ['Makan 50 persen.'],
        saran: ['Pertahankan batas harian.'],
        provider: 'gemini',
      },
      quota: { used: 1, limit: 5, remaining: 4, exhausted: false },
    });

    const res = await runAnalysisAction('pribadi', { period: 'current' });
    expect(res.ok).toBe(true);
    expect(m.runAiAnalysis).toHaveBeenCalledWith(
      { pools: { auth: {}, app: {} }, userId: USER_ID, spaceId: SPACE_ID, kind: 'personal' },
      'current',
    );
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('menolak periode tidak sah dengan invalid tanpa memanggil runAiAnalysis', async () => {
    const res = await runAnalysisAction('pribadi', { period: 'next' as never });
    expect(res).toEqual({ ok: false, error: { code: 'invalid', field: 'period' } });
    expect(m.runAiAnalysis).not.toHaveBeenCalled();
  });

  it('menolak mode prototipe dengan PrototypeActionError', async () => {
    m.requireDataUser.mockResolvedValueOnce(null);
    await expect(runAnalysisAction('pribadi', { period: 'current' })).rejects.toThrow('prototipe');
    expect(m.runAiAnalysis).not.toHaveBeenCalled();
  });
});
