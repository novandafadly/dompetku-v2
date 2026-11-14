import type { AccountVM } from './types';

/**
 * Dompet yang boleh membayar tagihan atau memegang utang: ruang ini, aktif, bukan Kas Kantor, bukan
 * Trading (modal tidak dibelanjakan; S12-TR4) dan bukan dompet sistem Patungan.
 */
export function payableAccounts(accounts: readonly AccountVM[]): AccountVM[] {
  return accounts.filter(
    (a) =>
      !a.archived && a.pocket !== 'kantor' && a.pocket !== 'trading' && a.pocket !== 'patungan',
  );
}
