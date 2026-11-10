import { formatRupiah } from '@dompetku/domain';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { REPLY } = await import('./handle');

describe('REPLY.recorded', () => {
  it('pengeluaran: tanpa label jenis', () => {
    expect(REPLY.recorded('expense', 'Makan Siang & Minum', 25_000, 'personal')).toBe(
      `✅ Makan Siang & Minum ${formatRupiah(25_000)} · Pribadi · ketik batal untuk membatalkan`,
    );
  });
  it('pemasukan: berlabel "Pemasukan"', () => {
    expect(REPLY.recorded('income', 'Gaji', 1_500_000, 'shared')).toBe(
      `✅ Pemasukan · Gaji ${formatRupiah(1_500_000)} · Bersama · ketik batal untuk membatalkan`,
    );
  });
});
