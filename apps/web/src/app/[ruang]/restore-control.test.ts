import { describe, expect, it } from 'vitest';
import type { EntryVM } from '@/features/ledger/types';
import { restoreFailedText, restoredBalance } from './restore-control';

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

describe('pulihkan cicilan utang (S11)', () => {
  it('payment_exceeds dan debt_deleted: salinan sendiri tanpa nominal', () => {
    expect(restoreFailedText('payment_exceeds')).toBe(
      'Belum bisa dipulihkan. Pembayaran ini akan melebihi sisa utang.',
    );
    expect(restoreFailedText('debt_deleted')).toBe(
      'Belum bisa dipulihkan. Utangnya sudah dihapus. Pulihkan dari Utang.',
    );
    for (const code of ['payment_exceeds', 'debt_deleted'] as const) {
      expect(restoreFailedText(code)).not.toMatch(/\d|Rp|server/);
    }
  });

  it('saldo sesudah pulih: cicilan keluar mengurangi, penerimaan menambah', () => {
    const e = (direction: 'in' | 'out'): EntryVM => ({
      id: 'e',
      version: 1,
      kind: 'debt_payment',
      occurredOn: '2026-11-02',
      createdAt: '2026-11-02T08:00:00+07:00',
      createdBy: { id: 'u', name: 'N', initial: 'N' },
      accountId: 'a',
      accountName: 'BCA',
      amount: 100_000,
      direction,
    });
    const account = { name: 'BCA', balance: 500_000 };
    expect(restoredBalance(e('out'), account)).toBe(400_000);
    expect(restoredBalance(e('in'), account)).toBe(600_000);
  });
});
