import { describe, expect, it } from 'vitest';
import type { LedgerErrorCode } from '@/features/ledger/types';
import { utangFailedText, utangRestoreFailedText } from './galat';

const CODES: LedgerErrorCode[] = [
  'debt_personal_only',
  'contact_name_taken',
  'contact_archived',
  'debt_deleted',
  'payment_exceeds',
  'payment_before_opened',
  'debt_account_kantor',
  'debt_principal_locked',
  'not_found',
  'conflict',
  'saldo_negatif',
  'account_archived',
  'before_opening',
  'restore_window_closed',
  'network',
  'unknown',
];

describe('salinan galat Utang (bingkai S11)', () => {
  it.each(CODES)('%s: tanpa nominal, tanpa "Hutang", tanpa tanda seru', (code) => {
    for (const t of [
      utangFailedText(code),
      utangFailedText(code, 'lent'),
      utangRestoreFailedText(code),
    ]) {
      expect(t).not.toMatch(/Rp|Hutang|!/);
      expect(t.replace('90 hari', '')).not.toMatch(/\d/);
      expect(t.length).toBeGreaterThan(10);
    }
  });

  it('payment_exceeds mengikuti arah; pulihkan memakai salinan sendiri', () => {
    expect(utangFailedText('payment_exceeds')).toContain('bayar sisanya');
    expect(utangFailedText('payment_exceeds', 'lent')).toContain('terima sisanya');
    expect(utangRestoreFailedText('payment_exceeds')).toBe(
      'Belum bisa dipulihkan. Sisa utangnya tidak cukup untuk pembayaran ini.',
    );
    expect(utangFailedText('debt_account_kantor')).toBe(
      'Dompet Kantor tidak bisa dipakai untuk utang. Pilih dompet lain.',
    );
  });
});
