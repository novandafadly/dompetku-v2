import type { Ruang } from '@/features/ledger/types';

/**
 * Langkah checklist "Mulai dari sini" mode nyata (tanpa label/aksi; dirangkai `BerandaReal`).
 * - Akun aman: selalu selesai (pengguna data sudah sesi penuh, faktor kuat).
 * - Tambah dompet: ada dompet di ruang ini.
 * - Catat satu pengeluaran: ada pengeluaran hidup di ruang ini.
 * - Undang Farida: hanya pemilik Bersama selama Bersama belum berisi dua orang (`invite`),
 *   di kedua ruang (kondisinya milik rumah tangga, bukan ruang).
 */
export interface BerandaStepState {
  key: 'aman' | 'dompet' | 'catat' | 'undang';
  done: boolean;
}

export function berandaSteps(i: {
  ruang: Ruang;
  hasAccount: boolean;
  hasExpense: boolean;
  invite: boolean;
}): BerandaStepState[] {
  const steps: BerandaStepState[] = [
    { key: 'aman', done: true },
    { key: 'dompet', done: i.hasAccount },
    { key: 'catat', done: i.hasExpense },
  ];
  if (i.invite) steps.push({ key: 'undang', done: false });
  return steps;
}
