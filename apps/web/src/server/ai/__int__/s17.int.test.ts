import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLedgerHarness,
  resetLedger,
  seedPersonas,
  type Persona,
} from '@/server/ledger/__int__/harness';
import { resolveSpace } from '@/server/ledger/space';
import { createAccount, createCategory, type LedgerCtx } from '@/server/ledger/write';
import { parseFreeTextEntry } from '../parse-entry';
import { LlmProviderError, type LlmParseRequest, type LlmProvider } from '../provider';
import { getAiQuota } from '../quota';

/**
 * S17 integrasi Postgres nyata:
 * - anti auto-simpan: `parseFreeTextEntry` tidak pernah menambah baris di `app.entries`;
 * - `[B13]`: parsing di ruang Bersama tidak pernah menyertakan dompet/kategori kanari Pribadi
 *   dalam prompt LLM maupun dalam hasil pratinjau;
 * - kuota harian (`0150_ai_kuota.sql`): batas 15/hari untuk `parse`, habis → parser aturan tetap jalan;
 * - failover multi-penyedia Gemini → Claude bekerja nyata di atas DB.
 */

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<LedgerCtx> {
  const { spaceId } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId };
}

describe('S17 integrasi — Catat teks bebas, kuota harian DB, dan B13', () => {
  let n: Persona;
  let f: Persona;
  let nPribadi: LedgerCtx;
  let nBersama: LedgerCtx;

  beforeEach(async () => {
    await resetLedger(h);
    const seeded = await seedPersonas(h, { farida: 'bergabung' });
    if (!seeded.f) throw new Error('persona kurang');
    n = seeded.n;
    f = seeded.f;
    nPribadi = await ctxOf(n, 'pribadi');
    nBersama = await ctxOf(n, 'bersama');
  });

  it('tidak pernah auto-simpan ke app.entries (100% baca-saja pada ledger)', async () => {
    await createAccount(nPribadi, {
      clientId: randomUUID(),
      name: 'BCA',
      walletType: 'bank',
      pocket: 'operasional',
      openingBalance: 1_000_000,
    });

    const before = await h.admin.query<{ cnt: number }>(
      'select count(*)::int as cnt from app.entries',
    );
    const res = await parseFreeTextEntry(nPribadi, 'makan siang 35rb bca', { providers: [] });
    const after = await h.admin.query<{ cnt: number }>(
      'select count(*)::int as cnt from app.entries',
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.preview.source).toBe('rules');
      expect(res.preview.amount).toBe(35_000);
      expect(res.preview.accountId).not.toBeNull();
    }
    expect(after.rows[0]?.cnt).toBe(before.rows[0]?.cnt);
  });

  it('[B13] parsing di Bersama tidak pernah melihat dompet/kategori kanari Pribadi di prompt maupun hasil', async () => {
    const CANARY_WALLET = 'DompetKanariPribadi991';
    const CANARY_CAT = 'KategoriKanariPribadi991';

    const { accountId: canaryWalletId } = await createAccount(nPribadi, {
      clientId: randomUUID(),
      name: CANARY_WALLET,
      walletType: 'bank',
      pocket: 'operasional',
      openingBalance: 500_000,
    });
    const { categoryId: canaryCatId } = await createCategory(nPribadi, {
      clientId: randomUUID(),
      name: CANARY_CAT,
      type: 'expense',
      icon: 'Tag',
    });

    await createAccount(nBersama, {
      clientId: randomUUID(),
      name: 'Kas Bersama',
      walletType: 'bank',
      pocket: 'operasional',
      openingBalance: 500_000,
    });

    let capturedReq: LlmParseRequest | undefined;
    const spyProvider: LlmProvider = {
      name: 'gemini',
      parseEntry: vi.fn((req: LlmParseRequest) => {
        capturedReq = req;
        // Simulasikan model mencoba mengembalikan nama kanari Pribadi: tetap harus ditolak (null).
        return Promise.resolve({
          type: 'expense' as const,
          amount: 40_000,
          description: 'Item khusus nonkategori',
          walletName: CANARY_WALLET,
          categoryName: CANARY_CAT,
          occurredOn: null,
        });
      }),
    };

    const res = await parseFreeTextEntry(nBersama, 'item khusus empat puluh ribu', {
      providers: [spyProvider],
    });

    expect(capturedReq).toBeDefined();
    expect(JSON.stringify(capturedReq)).not.toContain(CANARY_WALLET);
    expect(JSON.stringify(capturedReq)).not.toContain(CANARY_CAT);
    expect(capturedReq?.wallets).toContain('Kas Bersama');
    expect(capturedReq?.wallets.some((w) => w.toLowerCase() === 'patungan')).toBe(false);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.preview.source).toBe('gemini');
      expect(res.preview.accountId).not.toBe(canaryWalletId);
      expect(res.preview.categoryId).not.toBe(canaryCatId);
      expect(res.preview.accountId).toBeNull();
      expect(res.preview.categoryId).toBeNull();
    }
  });

  it('kuota harian 15/hari untuk parse, habis → aturan tetap bekerja; isolasi per user', async () => {
    await createAccount(nPribadi, {
      clientId: randomUUID(),
      name: 'BCA',
      walletType: 'bank',
      pocket: 'operasional',
      openingBalance: 1_000_000,
    });

    const geminiFail: LlmProvider = {
      name: 'gemini',
      parseEntry: vi.fn().mockRejectedValue(new LlmProviderError('gemini', 'http', 503)),
    };
    const claudeOk: LlmProvider = {
      name: 'anthropic',
      parseEntry: vi.fn().mockResolvedValue({
        type: 'expense',
        amount: 25_000,
        description: 'Kopi susu',
        walletName: 'BCA',
        categoryName: null,
        occurredOn: null,
      }),
    };

    // 15 kali pemanggilan AI (failover Gemini → Claude) harus berhasil semua.
    for (let i = 1; i <= 15; i++) {
      const r = await parseFreeTextEntry(nPribadi, 'beli kopi dua puluh lima ribu', {
        providers: [geminiFail, claudeOk],
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.preview.source).toBe('anthropic');
        expect(r.preview.quota).toEqual({
          used: i,
          limit: 15,
          remaining: 15 - i,
          exhausted: false,
        });
      }
    }

    // Panggilan ke-16 dengan teks tanpa angka → ditolak kuota habis (provider tidak dipanggil lagi).
    const callsBefore = (claudeOk.parseEntry as ReturnType<typeof vi.fn>).mock.calls.length;
    const blocked = await parseFreeTextEntry(nPribadi, 'beli kopi dua puluh lima ribu', {
      providers: [geminiFail, claudeOk],
    });
    expect(blocked).toEqual({
      ok: false,
      code: 'quota_exceeded',
      quota: { used: 15, limit: 15, remaining: 0, exhausted: true },
    });
    expect((claudeOk.parseEntry as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);

    // Meski kuota AI habis, format aturan standar TETAP bekerja!
    const ruleStillWorks = await parseFreeTextEntry(nPribadi, 'makan siang 35rb bca', {
      providers: [geminiFail, claudeOk],
    });
    expect(ruleStillWorks.ok).toBe(true);
    if (ruleStillWorks.ok) {
      expect(ruleStillWorks.preview.source).toBe('rules');
      expect(ruleStillWorks.preview.amount).toBe(35_000);
    }

    // Kuota pengguna lain (f) tidak terpengaruh sama sekali (tetap 0/15).
    const fQuota = await getAiQuota({ pools: h.pools, userId: f.id }, 'parse');
    expect(fQuota).toHaveLength(1);
    expect(fQuota[0]?.used).toBe(0);
    expect(fQuota[0]?.remaining).toBe(15);
  });
});
