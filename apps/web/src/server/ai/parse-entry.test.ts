import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pools } from '@/server/db';
import type { LlmProvider } from './provider';
import { LlmProviderError } from './provider';

const m = vi.hoisted(() => ({
  withLedger: vi.fn(),
  consumeAiQuotaTx: vi.fn(),
}));

vi.mock('@/server/ledger/retry', () => ({
  withLedger: m.withLedger,
}));

vi.mock('./quota', () => ({
  consumeAiQuotaTx: m.consumeAiQuotaTx,
}));

import { parseFreeTextEntry } from './parse-entry';

const CTX = {
  pools: {} as Pools,
  userId: '11111111-1111-4111-8111-111111111111',
  spaceId: '22222222-2222-4222-8222-222222222222',
};

function setupMockDb() {
  const client = {
    query: vi.fn((sql: string) => {
      if (sql.includes('app.today()')) {
        return Promise.resolve({ rows: [{ today: '2026-11-24' }] });
      }
      if (sql.includes('from app.accounts')) {
        return Promise.resolve({
          rows: [
            { id: 'acc-bca', name: 'BCA', pocket: 'operasional' },
            { id: 'acc-gopay', name: 'GoPay', pocket: 'operasional' },
          ],
        });
      }
      if (sql.includes('from app.categories')) {
        return Promise.resolve({
          rows: [
            { id: 'cat-makan', name: 'Makan & Minum', type: 'expense' },
            { id: 'cat-gaji', name: 'Gaji', type: 'income' },
          ],
        });
      }
      throw new Error(`Query tak terduga: ${sql}`);
    }),
  };
  m.withLedger.mockImplementation(
    (_pools: unknown, _u: unknown, _s: unknown, fn: (c: typeof client) => Promise<unknown>) =>
      fn(client),
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  setupMockDb();
});

describe('parseFreeTextEntry (hibrida aturan + multi-provider Claude/Gemini)', () => {
  it('kalimat standar terbaca oleh aturan tanpa memotong kuota AI', async () => {
    const geminiParse = vi.fn();
    const gemini: LlmProvider = {
      name: 'gemini',
      parseEntry: geminiParse,
    };
    const res = await parseFreeTextEntry(CTX, 'makan siang 35rb bca', { providers: [gemini] });
    expect(res).toEqual({
      ok: true,
      preview: {
        type: 'expense',
        amount: 35_000,
        description: 'makan siang',
        accountId: 'acc-bca',
        categoryId: 'cat-makan',
        occurredOn: null,
        source: 'rules',
      },
    });
    expect(m.consumeAiQuotaTx).not.toHaveBeenCalled();
    expect(geminiParse).not.toHaveBeenCalled();
  });

  it('melakukan failover Gemini → Claude saat Gemini gagal dan memetakan hasil ke ruang aktif', async () => {
    m.consumeAiQuotaTx.mockResolvedValue({ allowed: true, used: 1, limit: 15, remaining: 14 });
    const geminiParse = vi.fn().mockRejectedValue(new LlmProviderError('gemini', 'timeout'));
    const gemini: LlmProvider = {
      name: 'gemini',
      parseEntry: geminiParse,
    };
    const claudeParse = vi.fn().mockResolvedValue({
      type: 'expense',
      amount: 35_000,
      description: 'Makan siang',
      walletName: 'BCA',
      categoryName: 'Makan & Minum',
      occurredOn: '2026-11-23',
    });
    const claude: LlmProvider = {
      name: 'anthropic',
      parseEntry: claudeParse,
    };

    const res = await parseFreeTextEntry(CTX, 'tadi beli makan tiga puluh lima ribu pakai bca', {
      providers: [gemini, claude],
    });
    expect(res).toEqual({
      ok: true,
      preview: {
        type: 'expense',
        amount: 35_000,
        description: 'Makan siang',
        accountId: 'acc-bca',
        categoryId: 'cat-makan',
        occurredOn: '2026-11-23',
        source: 'anthropic',
        quota: { used: 1, limit: 15, remaining: 14, exhausted: false },
      },
    });
    expect(m.consumeAiQuotaTx).toHaveBeenCalledTimes(1);
    expect(geminiParse).toHaveBeenCalledTimes(1);
    expect(claudeParse).toHaveBeenCalledTimes(1);
  });

  it('saat kuota AI habis, parser aturan tetap mengembalikan hasil untuk kalimat berkeyakinan rendah', async () => {
    m.consumeAiQuotaTx.mockResolvedValue({ allowed: false, used: 15, limit: 15, remaining: 0 });
    const geminiParse = vi.fn();
    const gemini: LlmProvider = { name: 'gemini', parseEntry: geminiParse };

    // Kalimat 4 kata tanpa kategori cocok → confidence low → coba kuota → habis → fallback rules
    const res = await parseFreeTextEntry(CTX, 'beli barang unik sekali 45rb bca', {
      providers: [gemini],
    });
    expect(res).toEqual({
      ok: true,
      preview: {
        type: 'expense',
        amount: 45_000,
        description: 'beli barang unik sekali',
        accountId: 'acc-bca',
        categoryId: null,
        occurredOn: null,
        source: 'rules',
        quota: { used: 15, limit: 15, remaining: 0, exhausted: true },
      },
    });
    expect(geminiParse).not.toHaveBeenCalled();
  });

  it('saat kuota AI habis dan aturan tidak menemukan nominal, mengembalikan quota_exceeded', async () => {
    m.consumeAiQuotaTx.mockResolvedValue({ allowed: false, used: 15, limit: 15, remaining: 0 });
    const gemini: LlmProvider = { name: 'gemini', parseEntry: vi.fn() };
    const res = await parseFreeTextEntry(CTX, 'beli kopi dua puluh ribu', { providers: [gemini] });
    expect(res).toEqual({
      ok: false,
      code: 'quota_exceeded',
      quota: { used: 15, limit: 15, remaining: 0, exhausted: true },
    });
  });

  it('mengabaikan dompet & kategori dari LLM yang tidak ada di ruang aktif (B13)', async () => {
    m.consumeAiQuotaTx.mockResolvedValue({ allowed: true, used: 2, limit: 15, remaining: 13 });
    const gemini: LlmProvider = {
      name: 'gemini',
      parseEntry: vi.fn().mockResolvedValue({
        type: 'expense',
        amount: 50_000,
        description: 'Barang rahasia',
        walletName: 'Dompet Pribadi Pasangan',
        categoryName: 'Kategori Ruang Lain',
        occurredOn: null,
      }),
    };
    const res = await parseFreeTextEntry(CTX, 'beli barang lima puluh ribu', {
      providers: [gemini],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.preview.accountId).toBeNull();
      expect(res.preview.categoryId).toBeNull();
    }
  });

  it('menolak tanggal masa depan dari LLM', async () => {
    m.consumeAiQuotaTx.mockResolvedValue({ allowed: true, used: 3, limit: 15, remaining: 12 });
    const gemini: LlmProvider = {
      name: 'gemini',
      parseEntry: vi.fn().mockResolvedValue({
        type: 'expense',
        amount: 50_000,
        description: 'Kopi',
        walletName: 'BCA',
        categoryName: 'Makan & Minum',
        occurredOn: '2026-12-01',
      }),
    };
    const res = await parseFreeTextEntry(CTX, 'kopi lima puluh ribu', { providers: [gemini] });
    expect(res).toEqual({
      ok: false,
      code: 'future_date',
      quota: { used: 3, limit: 15, remaining: 12, exhausted: false },
    });
  });

  it('membedakan semua penyedia LLM gagal (network) dari jawaban valid tanpa nominal (no_amount)', async () => {
    m.consumeAiQuotaTx.mockResolvedValue({ allowed: true, used: 4, limit: 15, remaining: 11 });
    const failingProvider: LlmProvider = {
      name: 'gemini',
      parseEntry: vi.fn().mockRejectedValue(new LlmProviderError('gemini', 'timeout')),
    };
    const netRes = await parseFreeTextEntry(CTX, 'kopi dua puluh lima ribu', {
      providers: [failingProvider],
    });
    expect(netRes).toEqual({
      ok: false,
      code: 'network',
      quota: { used: 4, limit: 15, remaining: 11, exhausted: false },
    });

    const noAmtProvider: LlmProvider = {
      name: 'anthropic',
      parseEntry: vi.fn().mockResolvedValue(null),
    };
    const noAmtRes = await parseFreeTextEntry(CTX, 'cuma ngobrol biasa', {
      providers: [noAmtProvider],
    });
    expect(noAmtRes).toEqual({
      ok: false,
      code: 'no_amount',
      quota: { used: 4, limit: 15, remaining: 11, exhausted: false },
    });
  });
});
