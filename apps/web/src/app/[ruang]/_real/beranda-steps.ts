import type { Ruang } from '@/features/ledger/types';
import type { BerandaBersama } from '@/server/ledger/beranda';

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

/**
 * Turunan tampilan Bersama (S7-B1/B2) dari `BerandaData.bersama`. `solo` = hanya satu anggota
 * (tanpa avatar/nama anggota kedua); `invite` = kartu ajakan: hanya pemilik, `baru` (belum ada
 * undangan) atau `menunggu`; `empty` = tanpa dompet operasional dan tanpa entri.
 */
export interface BersamaView {
  solo: boolean;
  empty: boolean;
  invite: 'none' | 'baru' | 'menunggu';
}

export function bersamaView(
  ruang: Ruang,
  b: Pick<BerandaBersama, 'members' | 'isOwner' | 'empty' | 'pendingInvite'> | null,
): BersamaView {
  if (ruang !== 'bersama' || b === null) return { solo: false, empty: false, invite: 'none' };
  const solo = b.members < 2;
  const invite = !solo || !b.isOwner ? 'none' : b.pendingInvite ? 'menunggu' : 'baru';
  return { solo, empty: b.empty, invite };
}
