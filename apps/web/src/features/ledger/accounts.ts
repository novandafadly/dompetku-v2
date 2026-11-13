import type { AccountVM } from './types';

/** Dompet yang boleh membayar tagihan: ruang ini, aktif, bukan Kas Kantor. */
export function payableAccounts(accounts: readonly AccountVM[]): AccountVM[] {
  return accounts.filter((a) => !a.archived && a.pocket !== 'kantor');
}
