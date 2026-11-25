// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmAnalysisRequest, LlmProvider } from './provider';
import { LlmProviderError } from './provider';

const m = vi.hoisted(() => ({
  withLedger: vi.fn(),
  resolveViewed: vi.fn(),
  trendTx: vi.fn(),
  categoriesTx: vi.fn(),
  safeToSpendTx: vi.fn(),
  getAiQuotaTx: vi.fn(),
  consumeAiQuotaTx: vi.fn(),
}));

vi.mock('@/server/ledger/retry', () => ({
  withLedger: m.withLedger,
}));
vi.mock('@/server/ledger/laporan', () => ({
  resolveViewed: m.resolveViewed,
  trendTx: m.trendTx,
  categoriesTx: m.categoriesTx,
}));
vi.mock('@/server/ledger/read', () => ({
  periodLabel: () => 'November 2026 · 25 Okt – 24 Nov',
  safeToSpendTx: m.safeToSpendTx,
}));
vi.mock('./quota', () => ({
  getAiQuotaTx: m.getAiQuotaTx,
  consumeAiQuotaTx: m.consumeAiQuotaTx,
}));

import { loadAnalysisOverview, runAiAnalysis } from './analyze';

const CTX = {
  pools: {} as never,
  userId: '11111111-1111-4111-8111-111111111111',
  spaceId: '22222222-2222-4222-8222-222222222222',
  kind: 'personal' as const,
};

const PREV_ROW = {
  labelMonth: '2026-10-01',
  from: '2026-09-25',
  to: '2026-10-24',
  pemasukan: 10_000_000,
  pengeluaran: 4_500_000,
  selisih: 5_500_000,
  complete: true,
  isCurrent: false,
  daysLeft: null,
  deltaPengeluaran: null,
  holidaysKnown: true,
};

const CURR_ROW = {
  labelMonth: '2026-11-01',
  from: '2026-10-25',
  to: '2026-11-24',
  pemasukan: 12_000_000,
  pengeluaran: 6_000_000,
  selisih: 6_000_000,
  complete: false,
  isCurrent: true,
  daysLeft: 10,
  deltaPengeluaran: 1_500_000,
  holidaysKnown: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.withLedger.mockImplementation(
    (_p: unknown, _u: unknown, _s: unknown, fn: (c: unknown) => unknown) => fn({}),
  );
  m.resolveViewed.mockResolvedValue({ current: '2026-11', viewed: '2026-11' });
  m.trendTx.mockResolvedValue([PREV_ROW, CURR_ROW]);
  m.categoriesTx.mockResolvedValue([
    {
      kind: 'category',
      rootCategoryId: 'c1',
      categoryId: 'c1',
      type: 'expense',
      amount: 3_000_000,
      entryCount: 15,
      typeTotal: 6_000_000,
      pct10: 500,
      rootTotal: 3_000_000,
      rootPct10: 500,
      pct10InRoot: null,
      name: 'Makan & Minum',
      icon: 'fork-knife',
      archived: false,
    },
  ]);
  m.safeToSpendTx.mockResolvedValue({
    operasional: 5_000_000,
    billsUntilEom: 500_000,
    budgetWajibRemaining: 500_000,
    aman: 4_000_000,
    until: '2026-11-24',
    daysLeft: 10,
    perDay: 400_000,
  });
  m.getAiQuotaTx.mockResolvedValue([
    { feature: 'analysis', used: 1, limit: 5, remaining: 4, day: '2026-11-14' },
  ]);
  m.consumeAiQuotaTx.mockResolvedValue({
    allowed: true,
    used: 2,
    limit: 5,
    remaining: 3,
    day: '2026-11-14',
  });
});

describe('loadAnalysisOverview & runAiAnalysis (S18)', () => {
  it('memuat ringkasan SQL dan kategori teratas tanpa memotong kuota', async () => {
    const overview = await loadAnalysisOverview(CTX, 'current', { providers: [] });
    expect(overview.income).toBe(12_000_000);
    expect(overview.expense).toBe(6_000_000);
    expect(overview.safeToSpend).toBe(4_000_000);
    expect(overview.topCategories).toEqual([
      { name: 'Makan & Minum', amount: 3_000_000, pct: 50, entryCount: 15 },
    ]);
    expect(overview.aiConfigured).toBe(false);
    expect(m.consumeAiQuotaTx).not.toHaveBeenCalled();
  });

  it('tidak memotong kuota jika periode kosong atau penyedia AI tidak aktif', async () => {
    m.trendTx.mockResolvedValueOnce([
      PREV_ROW,
      { ...CURR_ROW, pemasukan: 0, pengeluaran: 0, selisih: 0 },
    ]);
    const dummy: LlmProvider = {
      name: 'gemini',
      parseEntry: vi.fn(),
      analyzeSpending: vi.fn(),
    };
    const empty = await runAiAnalysis(CTX, 'current', { providers: [dummy] });
    expect(empty).toEqual({ ok: false, code: 'no_data' });
    expect(m.consumeAiQuotaTx).not.toHaveBeenCalled();

    const off = await runAiAnalysis(CTX, 'current', { providers: [] });
    expect(off).toEqual({ ok: false, code: 'not_configured' });
    expect(m.consumeAiQuotaTx).not.toHaveBeenCalled();
  });

  it('menghormati kuota habis 5/5 tanpa memanggil penyedia LLM', async () => {
    m.consumeAiQuotaTx.mockResolvedValueOnce({
      allowed: false,
      used: 5,
      limit: 5,
      remaining: 0,
      day: '2026-11-14',
    });
    const analyzeSpy = vi.fn();
    const provider: LlmProvider = {
      name: 'gemini',
      parseEntry: vi.fn(),
      analyzeSpending: analyzeSpy,
    };
    const res = await runAiAnalysis(CTX, 'current', { providers: [provider] });
    expect(res).toEqual({
      ok: false,
      code: 'quota_exceeded',
      quota: { used: 5, limit: 5, remaining: 0, exhausted: true },
    });
    expect(analyzeSpy).not.toHaveBeenCalled();
  });

  it('failover Gemini → Claude dan hanya mengirim agregat (B13)', async () => {
    let seenReq: LlmAnalysisRequest | undefined;
    const gemini: LlmProvider = {
      name: 'gemini',
      parseEntry: vi.fn(),
      analyzeSpending: vi.fn().mockRejectedValue(new LlmProviderError('gemini', 'timeout')),
    };
    const claude: LlmProvider = {
      name: 'anthropic',
      parseEntry: vi.fn(),
      analyzeSpending: vi.fn().mockImplementation((req: LlmAnalysisRequest) => {
        seenReq = req;
        return Promise.resolve({
          ringkasan:
            'Pengeluaran periode ini masih setengah dari pemasukan dan sisa aman cukup lega.',
          sorotan: ['Makan & Minum menjadi pos terbesar sebesar 50 persen.'],
          saran: ['Pertahankan batas harian agar sisa aman terjaga hingga akhir periode.'],
        });
      }),
    };

    const res = await runAiAnalysis(CTX, 'current', { providers: [gemini, claude] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.analysis.provider).toBe('anthropic');
    expect(res.quota).toEqual({ used: 2, limit: 5, remaining: 3, exhausted: false });
    expect(seenReq).toEqual({
      spaceKind: 'personal',
      periodLabel: 'November 2026 · 25 Okt – 24 Nov',
      income: 12_000_000,
      expense: 6_000_000,
      net: 6_000_000,
      previousExpense: 4_500_000,
      safeToSpend: 4_000_000,
      daysLeft: 10,
      topCategories: [{ name: 'Makan & Minum', amount: 3_000_000, pct: 50 }],
    });
  });

  it('menyertakan kategori induk yang seluruh transaksinya di subkategori dan menjumlahkan entryCount', async () => {
    m.categoriesTx.mockResolvedValueOnce([
      {
        kind: 'category',
        rootCategoryId: 'root-tr',
        categoryId: 'root-tr',
        type: 'expense',
        amount: 0,
        entryCount: 0,
        typeTotal: 1_000_000,
        pct10: 0,
        rootTotal: 600_000,
        rootPct10: 600,
        pct10InRoot: null,
        name: 'Transportasi',
        icon: 'car-simple',
        archived: false,
      },
      {
        kind: 'category',
        rootCategoryId: 'root-tr',
        categoryId: 'sub-ojek',
        type: 'expense',
        amount: 600_000,
        entryCount: 4,
        typeTotal: 1_000_000,
        pct10: 600,
        rootTotal: 600_000,
        rootPct10: 600,
        pct10InRoot: 1000,
        name: 'Ojek',
        icon: 'car-simple',
        archived: false,
      },
    ]);
    const overview = await loadAnalysisOverview(CTX, 'current', { providers: [] });
    expect(overview.topCategories).toEqual([
      { name: 'Transportasi', amount: 600_000, pct: 60, entryCount: 4 },
    ]);
  });
});
