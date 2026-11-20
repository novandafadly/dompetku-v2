import type { AccountVM } from './types';

/**
 * Dompet yang boleh membayar tagihan atau memegang utang: ruang ini, aktif, bukan Kas Kantor, bukan
 * Trading (modal tidak dibelanjakan; S12-TR4), bukan dompet sistem Patungan, dan bukan aset (aset
 * tidak dibelanjakan, S14: DB menolak `asset_account_invalid`).
 */
export function payableAccounts(accounts: readonly AccountVM[]): AccountVM[] {
  return accounts.filter(
    (a) =>
      !a.archived &&
      a.pocket !== 'kantor' &&
      a.pocket !== 'trading' &&
      a.pocket !== 'patungan' &&
      a.pocket !== 'aset',
  );
}

/**
 * Tujuan transfer antar ruang: dompet biasa ({@link payableAccounts}) ditambah aset non-saham bila
 * ruang tujuan Bersama (S14-NW2: setor Pribadi → aset Bersama, B16). Aset Pribadi tidak pernah
 * ditawarkan sebagai tujuan, dan dompet saham tidak pernah (hanya berubah lewat Beli/Jual).
 */
export function spaceTransferTargets(
  accounts: readonly AccountVM[],
  toRuang: 'pribadi' | 'bersama',
): AccountVM[] {
  const plain = payableAccounts(accounts);
  if (toRuang !== 'bersama') return plain;
  const assets = accounts.filter(
    (a) => !a.archived && a.pocket === 'aset' && a.assetKind !== 'saham',
  );
  return [...plain, ...assets];
}
