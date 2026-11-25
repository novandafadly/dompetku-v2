import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLedgerHarness,
  resetLedger,
  seedPersonas,
  type Persona,
} from '@/server/ledger/__int__/harness';
import { loadDetail } from '@/server/ledger/detail';
import { resolveSpace } from '@/server/ledger/space';
import {
  addEntryAttachment,
  deleteEntryAttachment,
  getDecryptedAttachment,
  ReceiptValidationError,
} from '@/server/ledger/struk';
import { parseReceiptEncryptionKey } from '@/server/ledger/struk-crypto';
import { createAccount, createCategory, createEntry, type LedgerCtx } from '@/server/ledger/write';
import { loadAnalysisOverview, runAiAnalysis } from '../analyze';
import { LlmProviderError, type LlmAnalysisRequest, type LlmProvider } from '../provider';
import { getAiQuota } from '../quota';

/**
 * S18 integrasi Postgres nyata:
 * 1. Foto struk terenkripsi AES-256-GCM:
 *    - ciphertext di DB bukan plaintext PNG; round-trip dekripsi identik byte-per-byte;
 *    - kunci salah ditolak (decrypt_failed);
 *    - [B13] Farida tidak bisa membaca atau menghapus foto struk Pribadi milik Novanda;
 *    - foto struk di ruang Bersama bisa dibaca kedua anggota;
 *    - batas maks 3 foto per entri hidup (ke-4 = DK422 attachment_limit);
 *    - hapus permanen menghilangkan baris + ciphertext tuntas.
 * 2. Analisis AI:
 *    - [B13] prompt analisis ruang Bersama HANYA membawa angka agregat ruang Bersama —
 *      tidak pernah deskripsi entri mentah maupun kategori/angka kanari Pribadi;
 *    - kuota harian `analysis` (5/hari/user WIB) ditegakkan di DB;
 *    - failover multi-penyedia Gemini → Claude bekerja nyata.
 */

const h = createLedgerHarness();

const TEST_KEY = parseReceiptEncryptionKey('11'.repeat(32));
const WRONG_KEY = parseReceiptEncryptionKey('22'.repeat(32));
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

afterAll(async () => {
  await h.close();
});

async function ctxOf(
  p: Persona,
  ruang: 'pribadi' | 'bersama',
): Promise<LedgerCtx & { kind: 'personal' | 'shared' }> {
  const { spaceId, kind } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId, kind };
}

describe('S18 integrasi — Foto struk terenkripsi, Analisis AI, kuota 5/hari, dan B13', () => {
  let n: Persona;
  let f: Persona;
  let nPribadi: LedgerCtx & { kind: 'personal' | 'shared' };
  let nBersama: LedgerCtx & { kind: 'personal' | 'shared' };
  let fPribadi: LedgerCtx & { kind: 'personal' | 'shared' };
  let fBersama: LedgerCtx & { kind: 'personal' | 'shared' };

  beforeEach(async () => {
    await resetLedger(h);
    const seeded = await seedPersonas(h, { farida: 'bergabung' });
    if (!seeded.f) throw new Error('persona kurang');
    n = seeded.n;
    f = seeded.f;
    nPribadi = await ctxOf(n, 'pribadi');
    nBersama = await ctxOf(n, 'bersama');
    fPribadi = await ctxOf(f, 'pribadi');
    fBersama = await ctxOf(f, 'bersama');
  });

  it('[B13] foto struk dienkripsi AES-256-GCM di DB, terisolasi antar ruang, maks 3, hapus permanen', async () => {
    if (!TEST_KEY || !WRONG_KEY) throw new Error('kunci uji null');

    const { accountId: accPribadi } = await createAccount(nPribadi, {
      clientId: randomUUID(),
      name: 'BCA N',
      walletType: 'bank',
      pocket: 'operasional',
      openingBalance: 1_000_000,
    });
    const { categoryId: catPribadi } = await createCategory(nPribadi, {
      clientId: randomUUID(),
      name: 'Kopi Pribadi',
      type: 'expense',
      icon: 'Coffee',
    });
    const { entryId: entryPribadi } = await createEntry(nPribadi, {
      clientId: randomUUID(),
      kind: 'expense',
      accountId: accPribadi,
      categoryId: catPribadi,
      amount: 45_000,
      description: 'Kopi Pribadi Rahasia',
    });

    const att1 = await addEntryAttachment(
      nPribadi,
      { entryId: entryPribadi, bytes: TINY_PNG },
      { key: TEST_KEY },
    );
    expect(att1.mimeType).toBe('image/png');
    expect(att1.byteSize).toBe(TINY_PNG.length);

    // Pastikan kolom bytea di Postgres menyimpan ciphertext (bukan header PNG 89 50 4E 47).
    const rawRow = await h.admin.query<{ ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }>(
      `select ciphertext, iv, auth_tag from app.entry_attachments where id = $1`,
      [att1.id],
    );
    const stored = rawRow.rows[0];
    expect(stored).toBeDefined();
    expect(stored?.ciphertext.equals(TINY_PNG)).toBe(false);
    expect(stored?.iv.length).toBe(12);
    expect(stored?.auth_tag.length).toBe(16);

    // Round-trip dekripsi identik byte-per-byte.
    const dec = await getDecryptedAttachment(
      nPribadi,
      { entryId: entryPribadi, attachmentId: att1.id },
      { key: TEST_KEY },
    );
    expect(dec?.mimeType).toBe('image/png');
    expect(dec?.bytes.equals(TINY_PNG)).toBe(true);

    // Kunci salah ditolak dengan decrypt_failed.
    await expect(
      getDecryptedAttachment(
        nPribadi,
        { entryId: entryPribadi, attachmentId: att1.id },
        { key: WRONG_KEY },
      ),
    ).rejects.toThrow(ReceiptValidationError);

    // loadDetail menyertakan metadata lampiran dalam satu transaksi.
    const detail = await loadDetail(nPribadi, entryPribadi);
    expect(detail?.attachments).toHaveLength(1);
    expect(detail?.attachments?.[0]?.id).toBe(att1.id);

    // B13: Farida (baik dari ruang Pribadi F maupun Bersama) tidak bisa membaca atau menghapus struk Pribadi N.
    expect(
      await getDecryptedAttachment(
        fPribadi,
        { entryId: entryPribadi, attachmentId: att1.id },
        { key: TEST_KEY },
      ),
    ).toBeNull();
    expect(
      await getDecryptedAttachment(
        fBersama,
        { entryId: entryPribadi, attachmentId: att1.id },
        { key: TEST_KEY },
      ),
    ).toBeNull();
    expect(
      await deleteEntryAttachment(fPribadi, { entryId: entryPribadi, attachmentId: att1.id }),
    ).toBe(false);

    // Batas maks 3 foto per entri hidup: ke-2 & ke-3 sukses, ke-4 DK422 attachment_limit.
    await addEntryAttachment(
      nPribadi,
      { entryId: entryPribadi, bytes: TINY_PNG },
      { key: TEST_KEY },
    );
    await addEntryAttachment(
      nPribadi,
      { entryId: entryPribadi, bytes: TINY_PNG },
      { key: TEST_KEY },
    );
    await expect(
      addEntryAttachment(nPribadi, { entryId: entryPribadi, bytes: TINY_PNG }, { key: TEST_KEY }),
    ).rejects.toMatchObject({ code: 'DK422', message: 'attachment_limit' });

    // Bersama: struk yang diunggah Novanda di ruang Bersama bisa dibaca Farida.
    const { accountId: accBersama } = await createAccount(nBersama, {
      clientId: randomUUID(),
      name: 'Kas Bersama',
      walletType: 'bank',
      pocket: 'operasional',
      openingBalance: 1_000_000,
    });
    const { categoryId: catBersama } = await createCategory(nBersama, {
      clientId: randomUUID(),
      name: 'Dapur Bersama',
      type: 'expense',
      icon: 'ShoppingCart',
    });
    const { entryId: entryBersama } = await createEntry(nBersama, {
      clientId: randomUUID(),
      kind: 'expense',
      accountId: accBersama,
      categoryId: catBersama,
      amount: 120_000,
      description: 'Belanja Dapur Bersama',
    });
    const sharedAtt = await addEntryAttachment(
      nBersama,
      { entryId: entryBersama, bytes: TINY_PNG },
      { key: TEST_KEY },
    );
    const readByF = await getDecryptedAttachment(
      fBersama,
      { entryId: entryBersama, attachmentId: sharedAtt.id },
      { key: TEST_KEY },
    );
    expect(readByF?.bytes.equals(TINY_PNG)).toBe(true);

    // Hapus permanen: baris hilang tuntas dari DB.
    expect(
      await deleteEntryAttachment(nPribadi, { entryId: entryPribadi, attachmentId: att1.id }),
    ).toBe(true);
    const afterDel = await h.admin.query<{ cnt: number }>(
      `select count(*)::int as cnt from app.entry_attachments where id = $1`,
      [att1.id],
    );
    expect(afterDel.rows[0]?.cnt).toBe(0);
  });

  it('[B13] Analisis AI hanya mengirim agregat ruang aktif (tanpa deskripsi/kanari Pribadi), kuota 5/hari, failover Gemini → Claude', async () => {
    const CANARY_CAT = 'KanariKategoriPribadi882';
    const CANARY_DESC = 'DeskripsiRahasiaTokoXYZ999';
    const SHARED_DESC = 'NotaDapurMentahYangTidakBolehDikirim777';

    // Data kanari di Pribadi Novanda.
    const { accountId: accP } = await createAccount(nPribadi, {
      clientId: randomUUID(),
      name: 'BCA Pribadi',
      walletType: 'bank',
      pocket: 'operasional',
      openingBalance: 5_000_000,
    });
    const { categoryId: catP } = await createCategory(nPribadi, {
      clientId: randomUUID(),
      name: CANARY_CAT,
      type: 'expense',
      icon: 'Tag',
    });
    await createEntry(nPribadi, {
      clientId: randomUUID(),
      kind: 'expense',
      accountId: accP,
      categoryId: catP,
      amount: 999_000,
      description: CANARY_DESC,
    });

    // Data nyata di Bersama.
    const { accountId: accB } = await createAccount(nBersama, {
      clientId: randomUUID(),
      name: 'Kas Bersama',
      walletType: 'bank',
      pocket: 'operasional',
      openingBalance: 3_000_000,
    });
    const { categoryId: catB } = await createCategory(nBersama, {
      clientId: randomUUID(),
      name: 'Belanja Bulanan',
      type: 'expense',
      icon: 'ShoppingCart',
    });
    await createEntry(nBersama, {
      clientId: randomUUID(),
      kind: 'expense',
      accountId: accB,
      categoryId: catB,
      amount: 450_000,
      description: SHARED_DESC,
    });

    const overview = await loadAnalysisOverview(fBersama, 'current', { providers: [] });
    expect(overview.expense).toBe(450_000);
    expect(overview.topCategories.map((c) => c.name)).toContain('Belanja Bulanan');
    expect(overview.topCategories.map((c) => c.name)).not.toContain(CANARY_CAT);

    // Failover Gemini (503) → Claude (sukses) + verifikasi isi prompt B13.
    const seen: LlmAnalysisRequest[] = [];
    const geminiFail: LlmProvider = {
      name: 'gemini',
      parseEntry: vi.fn(),
      analyzeSpending: vi.fn().mockRejectedValue(new LlmProviderError('gemini', 'http', 503)),
    };
    const claudeOk: LlmProvider = {
      name: 'anthropic',
      parseEntry: vi.fn(),
      analyzeSpending: vi.fn().mockImplementation((req: LlmAnalysisRequest) => {
        seen.push(req);
        return Promise.resolve({
          ringkasan: 'Pengeluaran ruang Bersama sebesar Rp 450.000 terpusat pada Belanja Bulanan.',
          sorotan: ['Belanja Bulanan mengambil porsi terbesar pada periode ini.'],
          saran: ['Catat rencana belanja mingguan agar sisa saldo tetap terukur.'],
        });
      }),
    };

    // Panggil 5 kali (batas harian 5/5) → semua berhasil, ke-6 ditolak quota_exceeded.
    for (let i = 1; i <= 5; i += 1) {
      const res = await runAiAnalysis(fBersama, 'current', { providers: [geminiFail, claudeOk] });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.analysis.provider).toBe('anthropic');
        expect(res.quota.used).toBe(i);
        expect(res.quota.remaining).toBe(5 - i);
      }
    }

    const sixth = await runAiAnalysis(fBersama, 'current', { providers: [claudeOk] });
    expect(sixth).toEqual({
      ok: false,
      code: 'quota_exceeded',
      quota: { used: 5, limit: 5, remaining: 0, exhausted: true },
    });

    // Pastikan prompt yang terkirim ke LLM tidak pernah mengandung kanari Pribadi maupun deskripsi mentah.
    const serialized = JSON.stringify(seen);
    expect(serialized).not.toContain(CANARY_CAT);
    expect(serialized).not.toContain(CANARY_DESC);
    expect(serialized).not.toContain(SHARED_DESC);
    expect(serialized).not.toContain('999000');
    expect(serialized).toContain('Belanja Bulanan');

    const [qRow] = await getAiQuota({ pools: h.pools, userId: f.id }, 'analysis');
    expect(qRow?.used).toBe(5);
    expect(qRow?.remaining).toBe(0);
  });
});
