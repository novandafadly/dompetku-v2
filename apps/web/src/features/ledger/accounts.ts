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
