import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatatDraft } from '@/features/catat/source';
import type { AccountVM, CategoryVM } from '@/features/ledger/types';
import { realCatatSource } from './catat-source-real';

const m = vi.hoisted(() => ({
  saveCatat: vi.fn(),
  catatOptions: vi.fn(),
  suggestFor: vi.fn(),
  voidEntryAction: vi.fn(),
}));

vi.mock('../_actions/catat', () => ({
  saveCatat: m.saveCatat,
  catatOptions: m.catatOptions,
  suggestFor: m.suggestFor,
}));
vi.mock('../_actions/entri', () => ({ voidEntryAction: m.voidEntryAction }));

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLIENT = '11111111-1111-4111-8111-111111111111';
const BCA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TUNAI = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUMAH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ENTRY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const acc = (id: string, name: string): AccountVM => ({
  id,
  name,
  pocket: 'operasional',
  walletType: 'bank',
  openedOn: '2026-01-01',
  archived: false,
  balance: 100_000,
});
const cat = (id: string, type: 'income' | 'expense' = 'expense'): CategoryVM => ({
  id,
  parentId: null,
  name: `Kategori ${id}`,
  type,
  icon: 'Tag',
  archived: false,
});

const PRIBADI = {
  accounts: [acc(BCA, 'BCA'), acc(TUNAI, 'Tunai')],
  categories: [
    ...['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'].map((id) => cat(id)),
    cat('g1', 'income'),
  ],
};
const BERSAMA = { accounts: [acc(RUMAH, 'Kas Rumah')], categories: [cat('b1')] };

function source() {
  return realCatatSource({
    ruang: 'pribadi',
    options: PRIBADI,
    ruangLabel: { pribadi: 'Pribadi', bersama: 'Bersama' },
  });
}

function draft(
  over: Partial<CatatDraft & { allowNegative: boolean }> = {},
): CatatDraft & { allowNegative: boolean } {
  return {
    type: 'expense',
    amount: 35_000,
    categoryId: 'k1',
    accountId: BCA,
    date: '2026-10-31',
    dateChosen: false,
    ruang: 'pribadi',
    clientId: CLIENT,
    allowNegative: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('realCatatSource', () => {
  it('options ruang awal dari props (tanpa action); ruang lain lewat catatOptions', async () => {
    const s = source();
    expect(s.options('pribadi')).toEqual(PRIBADI);
    expect(m.catatOptions).not.toHaveBeenCalled();
    m.catatOptions.mockResolvedValue({ ok: true, value: BERSAMA });
    await expect(s.options('bersama')).resolves.toEqual(BERSAMA);
    expect(m.catatOptions).toHaveBeenCalledWith('bersama');
  });

  it('options gagal = Promise ditolak', async () => {
    m.catatOptions.mockResolvedValue({ ok: false, error: { code: 'network' } });
    await expect(source().options('bersama')).rejects.toThrow();
  });

  it('chips lewat suggestFor sekali per (ruang, jenis), urutan server, lalu dibekukan', async () => {
    m.suggestFor.mockResolvedValue({ ok: true, value: ['k3', 'k1', 'hilang', 'k2'] });
    const s = source();
    const first = await s.chips('pribadi', 'expense', 9);
    expect(first.map((c) => c.id)).toEqual(['k3', 'k1', 'k2']);
    expect(m.suggestFor).toHaveBeenCalledWith('pribadi', { type: 'expense', hour: 9 });
    m.suggestFor.mockResolvedValue({ ok: true, value: ['k7'] });
    const again = await s.chips('pribadi', 'expense', 10);
    expect(again.map((c) => c.id)).toEqual(['k3', 'k1', 'k2']);
    expect(m.suggestFor).toHaveBeenCalledTimes(1);
  });

  it('chips tidak memanggil suggestFor sampai ditunggu (render yang diulang React tidak membanjiri server)', async () => {
    m.suggestFor.mockResolvedValue({ ok: true, value: ['k2'] });
    const s = source();
    // `useCatat` memanggil chips() saat render pertama; hanya membuat janji, tanpa permintaan.
    const pending = s.chips('pribadi', 'expense', 9);
    void s.chips('pribadi', 'expense', 9);
    await Promise.resolve();
    expect(m.suggestFor).not.toHaveBeenCalled();
    // Satu permintaan walau banyak penunggu.
    const [a, b] = await Promise.all([pending, s.chips('pribadi', 'expense', 9)]);
    expect(a.map((c) => c.id)).toEqual(['k2']);
    expect(b.map((c) => c.id)).toEqual(['k2']);
    expect(m.suggestFor).toHaveBeenCalledTimes(1);
  });

  it('chips: suggestFor gagal → 6 kategori aktif pertama jenis itu', async () => {
    m.suggestFor.mockResolvedValue({ ok: false, error: { code: 'network' } });
    const chips = await source().chips('pribadi', 'expense', 9);
    expect(chips.map((c) => c.id)).toEqual(['k1', 'k2', 'k3', 'k4', 'k5', 'k6']);
  });

  it('chips: options ruang lain gagal tidak dibekukan; permintaan berikutnya mencoba lagi', async () => {
    m.catatOptions.mockResolvedValueOnce({ ok: false, error: { code: 'network' } });
    const s = source();
    await expect(s.chips('bersama', 'expense', 9)).rejects.toThrow();
    m.catatOptions.mockResolvedValueOnce({ ok: true, value: BERSAMA });
    m.suggestFor.mockResolvedValue({ ok: true, value: ['b1'] });
    const chips = await s.chips('bersama', 'expense', 9);
    expect(chips.map((c) => c.id)).toEqual(['b1']);
    expect(m.catatOptions).toHaveBeenCalledTimes(2);
  });

  it('save tanpa tanggal dipilih: occurredOn TIDAK dikirim (server memakai app.today())', async () => {
    m.saveCatat.mockResolvedValue({
      ok: true,
      value: { entryId: ENTRY, version: 1, replayed: false },
    });
    const out = await source().save(draft());
    expect(m.saveCatat).toHaveBeenCalledTimes(1);
    const [ruang, input] = m.saveCatat.mock.calls[0] as [string, Record<string, unknown>];
    expect(ruang).toBe('pribadi');
    expect(input).toEqual({
      kind: 'expense',
      clientId: CLIENT,
      accountId: BCA,
      amount: 35_000,
      categoryId: 'k1',
      allowNegative: false,
    });
    expect('occurredOn' in input).toBe(false);
    expect(out).toEqual({
      ok: true,
      entryId: ENTRY,
      version: 1,
      replayed: false,
      toast: 'Tersimpan di Pribadi · Rp 35.000 dari BCA',
    });
  });

  it('save dengan tanggal dipilih mengirim occurredOn; keterangan ikut', async () => {
    m.saveCatat.mockResolvedValue({
      ok: true,
      value: { entryId: ENTRY, version: 1, replayed: true },
    });
    await source().save(
      draft({ dateChosen: true, date: '2026-10-30', description: 'kopi', allowNegative: true }),
    );
    expect(m.saveCatat.mock.calls[0]?.[1]).toEqual({
      kind: 'expense',
      clientId: CLIENT,
      accountId: BCA,
      amount: 35_000,
      categoryId: 'k1',
      occurredOn: '2026-10-30',
      description: 'kopi',
      allowNegative: true,
    });
  });

  it('pemasukan: toast "ke {dompet}"', async () => {
    m.saveCatat.mockResolvedValue({
      ok: true,
      value: { entryId: ENTRY, version: 1, replayed: false },
    });
    const out = await source().save(draft({ type: 'income', categoryId: 'g1' }));
    expect(out).toMatchObject({ toast: 'Tersimpan di Pribadi · Rp 35.000 ke BCA' });
  });

  it('transfer: fromAccountId/toAccountId', async () => {
    m.saveCatat.mockResolvedValue({
      ok: true,
      value: { entryId: ENTRY, version: 1, replayed: false },
    });
    const d = draft({ type: 'transfer', counterAccountId: TUNAI });
    delete d.categoryId;
    const out = await source().save(d);
    expect(m.saveCatat.mock.calls[0]?.[1]).toEqual({
      kind: 'transfer',
      clientId: CLIENT,
      fromAccountId: BCA,
      toAccountId: TUNAI,
      amount: 35_000,
      allowNegative: false,
    });
    expect(out).toMatchObject({ toast: 'Tersimpan di Pribadi · Rp 35.000 dari BCA ke Tunai' });
  });

  it('galat action diteruskan; lemparan (fetch putus) = network', async () => {
    m.saveCatat.mockResolvedValueOnce({ ok: false, error: { code: 'invalid', field: 'amount' } });
    await expect(source().save(draft())).resolves.toEqual({
      ok: false,
      code: 'invalid',
      field: 'amount',
    });
    m.saveCatat.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(source().save(draft())).resolves.toEqual({ ok: false, code: 'network' });
  });

  it('undo = voidEntryAction dengan expectedVersion versi simpan dan clientId UUID v4 baru', async () => {
    m.voidEntryAction.mockResolvedValue({ ok: true, value: { version: 2 } });
    await expect(source().undo({ entryId: ENTRY, version: 1, ruang: 'pribadi' })).resolves.toBe(
      true,
    );
    const [ruang, input] = m.voidEntryAction.mock.calls[0] as [
      string,
      { clientId: string; entryId: string; expectedVersion: number },
    ];
    expect(ruang).toBe('pribadi');
    expect(input.entryId).toBe(ENTRY);
    expect(input.expectedVersion).toBe(1);
    expect(input.clientId).toMatch(UUID_V4);
    expect(input.clientId).not.toBe(CLIENT);
    m.voidEntryAction.mockResolvedValue({ ok: false, error: { code: 'conflict' } });
    await expect(source().undo({ entryId: ENTRY, version: 1, ruang: 'pribadi' })).resolves.toBe(
      false,
    );
  });

  it('modul klien: tidak mengimpor server/** dan hanya fungsi action dari _actions', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(dir, 'catat-source-real.ts'), 'utf8');
    expect(src).not.toMatch(/from ['"]@\/server|server-only/);
    const valueImports = [...src.matchAll(/^import (?!type )[^;]*from ['"]([^'"]+)['"]/gm)].map(
      (x) => x[1],
    );
    for (const p of valueImports) {
      if (p?.includes('_actions')) expect(p).toMatch(/_actions\/(catat|entri)$/);
    }
    expect(src).not.toMatch(/^import (?!type )[^;]*_actions\/inputs/m);
  });
});
