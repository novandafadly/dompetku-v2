import { describe, expect, it } from 'vitest';
import { payableAccounts, spaceTransferTargets } from './accounts';
import type { AccountVM, AssetKind, Pocket } from './types';

const acc = (pocket: Pocket, archived = false, assetKind?: AssetKind): AccountVM => ({
  id: `${pocket}${assetKind ?? ''}${archived ? '-x' : ''}`,
  name: pocket,
  pocket,
  walletType: 'bank',
  openedOn: '2026-11-01',
  archived,
  balance: 1,
  ...(assetKind === undefined ? {} : { assetKind }),
});

describe('payableAccounts', () => {
  it('menyaring Kantor, Trading, Patungan, aset, dan dompet terarsip (S12-TR4, S14)', () => {
    const all = (['operasional', 'tabungan', 'kantor', 'trading', 'patungan', 'aset'] as const).map(
      (p) => acc(p),
    );
    expect(payableAccounts([...all, acc('operasional', true)]).map((a) => a.pocket)).toEqual([
      'operasional',
      'tabungan',
    ]);
  });
});

describe('spaceTransferTargets (S14-NW2)', () => {
  const all = [
    acc('operasional'),
    acc('kantor'),
    acc('aset', false, 'emas'),
    acc('aset', false, 'saham'),
    acc('aset', true, 'properti'),
  ];

  it('ke Bersama: dompet biasa + aset non-saham aktif', () => {
    expect(spaceTransferTargets(all, 'bersama').map((a) => a.id)).toEqual([
      'operasional',
      'asetemas',
    ]);
  });

  it('ke Pribadi: dompet biasa saja, aset tidak pernah ditawarkan', () => {
    expect(spaceTransferTargets(all, 'pribadi').map((a) => a.id)).toEqual(['operasional']);
  });
});
