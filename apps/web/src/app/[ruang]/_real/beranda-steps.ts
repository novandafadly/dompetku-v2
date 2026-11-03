import type { Ruang } from '@/features/ledger/types';

/**
 * Langkah checklist "Mulai dari sini" mode nyata (tanpa label/aksi; dirangkai `BerandaReal`),
 * setara pembungkus prototipe:
 * - Akun aman: selalu selesai (pengguna data sudah sesi penuh, faktor kuat).
 * - Tambah dompet: ada dompet operasional aktif di ruang ini (bukan tabungan/kantor/terarsip).
 * - Catat satu pengeluaran: ada pengeluaran hidup di ruang ini.
 * - Undang Farida: hanya di Pribadi, untuk pemilik Bersama selama Bersama belum berisi dua
 *   orang (`invite`).
 */
export interface BerandaStepState {
  key: 'aman' | 'dompet' | 'catat' | 'undang';
  done: boolean;
}

export function berandaSteps(i: {
  ruang: Ruang;
  hasOperasional: boolean;
  hasExpense: boolean;
  invite: boolean;
}): BerandaStepState[] {
  const steps: BerandaStepState[] = [
    { key: 'aman', done: true },
    { key: 'dompet', done: i.hasOperasional },
    { key: 'catat', done: i.hasExpense },
  ];
  if (i.ruang === 'pribadi' && i.invite) steps.push({ key: 'undang', done: false });
  return steps;
}
