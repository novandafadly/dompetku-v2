import { describe, expect, it } from 'vitest';
import { restoreFailedText } from './restore-control';

describe('restoreFailedText', () => {
  it('entry_moved memakai salinan tabel galat S7', () => {
    expect(restoreFailedText('entry_moved', 'Bersama')).toBe(
      'Transaksi ini sudah dipindahkan ke Bersama dan tidak bisa dipulihkan dari sini.',
    );
  });

  it('reimburse yang tidak lagi sah: salinan sendiri tanpa nominal, bukan "kendala di server"', () => {
    expect(restoreFailedText('not_reimbursable')).toBe(
      'Belum bisa dipulihkan. Talangannya tidak lagi menunggu diganti.',
    );
    expect(restoreFailedText('reimbursement_exceeds')).toBe(
      'Belum bisa dipulihkan. Sisa talangannya tidak cukup untuk reimburse ini.',
    );
    for (const code of ['not_reimbursable', 'reimbursement_exceeds'] as const) {
      expect(restoreFailedText(code)).not.toMatch(/\d|Rp/);
    }
  });
});
