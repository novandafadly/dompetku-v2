import { formatRupiah } from '@dompetku/domain';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { REPLY } = await import('./handle');

describe('REPLY.recorded', () => {
  it('pengeluaran: tanpa label jenis', () => {
    expect(REPLY.recorded('expense', 'Makan Siang & Minum', 25_000, 'personal', 'CIMB')).toBe(
      `✅ Makan Siang & Minum ${formatRupiah(25_000)} · Pribadi · CIMB · ketik batal untuk membatalkan`,
    );
  });
  it('pemasukan: berlabel "Pemasukan"', () => {
    expect(REPLY.recorded('income', 'Gaji', 1_500_000, 'shared', 'Kas Bersama')).toBe(
      `✅ Pemasukan · Gaji ${formatRupiah(1_500_000)} · Bersama · Kas Bersama · ketik batal untuk membatalkan`,
    );
  });
});

describe('REPLY dompet', () => {
  it('saldo tidak cukup menyebut dompet', () => {
    expect(REPLY.insufficient('CIMB')).toBe('❌ Saldo CIMB tidak cukup. Catat dari app.');
  });
  it('tidak ada: menyebut penanda dan daftar siap ketik', () => {
    expect(REPLY.walletNone('mandiri', 'personal', ['@bca', '@cimb'])).toBe(
      '❌ Dompet @mandiri tidak ada di ruang Pribadi. Pilih: @bca, @cimb',
    );
  });
  it('ambigu', () => {
    expect(REPLY.walletAmbiguous('bc', 'shared', ['@bca', '@bca-syariah'])).toBe(
      '❌ @bc cocok dengan lebih dari satu dompet di ruang Bersama. Tulis lebih lengkap. Pilih: @bca, @bca-syariah',
    );
  });
  it('daftar dipotong di 12 dan tidak ada daftar bila kosong', () => {
    const many = Array.from({ length: 15 }, (_, i) => `@d${String(i)}`);
    const text = REPLY.walletNone('x', 'personal', many);
    expect(text).toContain('@d11, …');
    expect(text).not.toContain('@d12');
    expect(REPLY.walletNone('x', 'personal', [])).toBe('❌ Dompet @x tidak ada di ruang Pribadi.');
  });
});
