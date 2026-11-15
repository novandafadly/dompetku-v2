import { describe, expect, it } from 'vitest';
import { payableAccounts } from './accounts';
import type { AccountVM, Pocket } from './types';

const acc = (pocket: Pocket, archived = false): AccountVM => ({
  id: `${pocket}${archived ? '-x' : ''}`,
  name: pocket,
  pocket,
  walletType: 'bank',
  openedOn: '2026-11-01',
  archived,
  balance: 1,
});

describe('payableAccounts', () => {
  it('menyaring Kantor, Trading, Patungan, dan dompet terarsip (S12-TR4)', () => {
    const all = (['operasional', 'tabungan', 'kantor', 'trading', 'patungan'] as const).map((p) =>
      acc(p),
    );
    expect(payableAccounts([...all, acc('operasional', true)]).map((a) => a.pocket)).toEqual([
      'operasional',
      'tabungan',
    ]);
  });
});
