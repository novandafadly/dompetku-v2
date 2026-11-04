import { formatRupiah } from '@dompetku/domain';
import { describe, expect, it } from 'vitest';
import type { EntryVM } from '@/features/ledger/types';
import { voidSentenceVM, voidedToastVM } from './void-dialog-view';

const base: EntryVM = {
  id: 'e',
  version: 1,
  kind: 'reimbursement',
  occurredOn: '2026-11-02',
  createdAt: '2026-11-02T08:00:00+07:00',
  createdBy: { id: 'u', name: 'N', initial: 'N' },
  accountId: 'a',
  accountName: 'BCA',
  amount: 100_000,
};

describe('Batalkan reimburse dan antar ruang (S7)', () => {
  it('toast reimburse memakai "ke" (uang masuk ke dompet), bukan "dari"', () => {
    expect(voidedToastVM('Pribadi', base)).toBe(
      `Dibatalkan di Pribadi · ${formatRupiah(100_000)} ke BCA`,
    );
  });

  it('kalimat dialog reimburse menambah "Sisa talangan bertambah lagi."', () => {
    expect(voidSentenceVM(base)).toContain(' Sisa talangan bertambah lagi. ');
    expect(voidSentenceVM(base)).toContain('Saldo BCA berkurang');
  });

  it('antar ruang: salinan S7-D1 kedua sisi, tanpa nama dompet ruang lain', () => {
    const st: EntryVM = { ...base, kind: 'space_transfer', direction: 'out', spaceKind: 'shared' };
    expect(voidSentenceVM(st)).toBe(
      'Kedua sisinya dibatalkan bersamaan, di Pribadi dan Bersama. Saldo kedua dompet kembali. Bisa dipulihkan dari Sampah selama 90 hari.',
    );
    expect(voidedToastVM('Bersama', st)).toBe(
      `Dibatalkan di Pribadi dan Bersama · ${formatRupiah(100_000)}`,
    );
  });
});
