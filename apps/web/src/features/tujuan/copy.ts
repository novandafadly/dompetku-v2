import { formatRupiah, shortDateLabel, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { Ruang } from '@/features/ledger/types';

/**
 * Salinan UI Tujuan tabungan (S13, bingkai `docs/design/s13-bingkai.md` "Salinan final S13").
 * Istilah baku `Tujuan` (tidak pernah "Goal"), tanpa tanda seru, tanpa "rumah tangga"; galat tanpa
 * nominal (nominal yang tampil di sini selalu data, bukan pesan galat). Nominal lewat
 * `formatRupiah`; UI tidak menjumlah.
 */

const RUANG_LABEL: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

/** `25 Mar 2027` (tanggal pasti, dengan tahun). */
export function dateWithYear(d: IsoDate): string {
  return `${shortDateLabel(d)} ${d.slice(0, 4)}`;
}

export const TUJUAN_COPY = {
  // Segmen dan daftar (TJ1, TJ2)
  segment: 'Tujuan',
  heading: 'Tujuan',
  add: 'Tambah tujuan',
  allHaveGoals:
    'Semua dompet tabungan sudah punya tujuan. Selesaikan atau arsipkan salah satunya, atau tambah dompet tabungan baru.',
  addWallet: 'Tambah dompet tabungan',
  emptyNoWalletTitle: 'Belum ada dompet tabungan.',
  emptyNoWalletDescription:
    'Tujuan menempel pada satu dompet tabungan. Progresnya mengikuti saldo dompet itu.',
  emptyNoGoalTitle: 'Belum ada tujuan.',
  emptyNoGoalDescription:
    'Pilih dompet tabungan, isi target, dan lihat progresnya dari saldo dompet itu.',
  closedGroup: (n: number) => `Selesai dan diarsipkan (${String(n)})`,
  completedOn: (d: IsoDate) => `Selesai ${dateWithYear(d)}`,
  archivedOn: (d: IsoDate) => `Diarsipkan ${dateWithYear(d)}`,
  targetShort: (target: Rupiah) => `target ${formatRupiah(target)}`,
  walletArchived: 'Dompet sudah diarsipkan',
  loading: 'Memuat tujuan…',
  failedTitle: 'Tujuan belum bisa dimuat.',
  failedDescription: 'Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang.',
  // Kartu (TJ3)
  ofTarget: (target: Rupiah) => `dari ${formatRupiah(target)}`,
  pct: (n: number) => `${String(n)}%`,
  belowOne: 'Kurang dari 1%',
  nothingSaved: 'Belum ada yang terkumpul',
  targetLine: (target: Rupiah) => `Target ${formatRupiah(target)}`,
  remaining: (n: Rupiah) => `Sisa ${formatRupiah(n)}`,
  needPerMonth: (n: Rupiah, on: IsoDate) =>
    `Perlu ${formatRupiah(n)}/bulan sampai ${dateWithYear(on)}`,
  needOnce: (n: Rupiah, on: IsoDate) => `Perlu ${formatRupiah(n)} sampai ${dateWithYear(on)}`,
  needNote: 'Dihitung per periode gajian, jadi angkanya bisa berubah menjelang tanggal gajian.',
  fillVia: (wallet: string) => `Isi lewat Transfer ke ${wallet}.`,
  walletNegative: (wallet: string) => `Saldo ${wallet} sedang minus, jadi progres dihitung 0%.`,
  reached: 'Tercapai',
  finishHint: (wallet: string) => `Selesaikan supaya ${wallet} bisa dipakai untuk tujuan baru.`,
  finish: 'Selesaikan tujuan',
  overdue: 'Lewat tanggal target',
  overdueHint: (on: IsoDate) =>
    `Target ${dateWithYear(on)} sudah lewat. Ubah tanggal atau hapus tanggalnya.`,
  edit: 'Ubah',
  archive: 'Arsipkan',
  viewWallet: 'Lihat dompet',
  // Detail dompet (TJ9)
  viewAll: 'Lihat semua tujuan',
  walletNoGoal: (wallet: string) => `Belum ada tujuan untuk ${wallet}.`,
  walletNoGoalHint: 'Pasang target, dan progresnya mengikuti saldo dompet ini.',
  create: 'Buat tujuan',
  createdBy: (name: string) => `Dibuat ${name}`,
  progressText: (pct: number, saved: Rupiah, target: Rupiah) =>
    saved === 0
      ? `Belum ada yang terkumpul dari ${formatRupiah(target)}`
      : pct === 0
        ? `Kurang dari 1 persen, ${formatRupiah(saved)} dari ${formatRupiah(target)}`
        : `${String(pct)} persen, ${formatRupiah(saved)} dari ${formatRupiah(target)}`,
  // Sheet Tambah / Ubah (TJ4, TJ5)
  addTitle: 'Tambah tujuan',
  editTitle: 'Ubah tujuan',
  nameField: 'Nama tujuan',
  nameHint: 'Misalnya Dana darurat atau Liburan Desember.',
  nameLeft: (n: number) => `Sisa ${String(n)} huruf.`,
  targetField: 'Target',
  walletField: 'Dompet tabungan',
  walletLocked: (wallet: string) => `Dompet: ${wallet}`,
  walletHasMoney: (wallet: string, balance: Rupiah) =>
    `Sudah ada ${formatRupiah(balance)} di ${wallet}. Progres dimulai dari saldo ini.`,
  walletEmpty: (wallet: string) => `${wallet} masih kosong. Isi lewat Transfer kapan saja.`,
  walletOnlySavings:
    'Hanya dompet tabungan yang bisa punya tujuan. Untuk dompet lain, buat dompet tabungan lalu pindahkan isinya.',
  dateField: 'Tanggal target (opsional)',
  dateHint:
    'Kosongkan bila tidak ada tenggat. Dengan tanggal, DompetKu menghitung berapa perlu disisihkan per bulan.',
  clearDate: 'Hapus tanggal',
  walletLockedNote:
    'Dompet tidak bisa diganti. Arsipkan tujuan ini lalu buat tujuan baru di dompet lain.',
  save: 'Simpan tujuan',
  saveChanges: 'Simpan perubahan',
  retry: 'Coba lagi',
  createdToast: (name: string, ruang: Ruang) => `Tujuan ${name} dibuat di ${RUANG_LABEL[ruang]}`,
  updatedToast: (name: string, ruang: Ruang) =>
    `Tujuan ${name} diperbarui di ${RUANG_LABEL[ruang]}`,
  sheetTitle: (base: string, ruang: Ruang) => `${base} · ${RUANG_LABEL[ruang]}`,
  // Dialog (TJ6, TJ7) dan Pulihkan (TJ8)
  finishTitle: (name: string) => `Selesaikan ${name}?`,
  finishBody: (wallet: string) =>
    `Tujuan pindah ke Selesai dan diarsipkan. Saldo ${wallet} tidak berubah, dan ${wallet} bisa dipakai untuk tujuan baru.`,
  finishConfirm: 'Selesaikan',
  back: 'Kembali',
  completedToast: (name: string) => `Tujuan ${name} selesai`,
  undo: 'Urungkan',
  archiveTitle: (name: string) => `Arsipkan ${name}?`,
  archiveBody: (wallet: string) =>
    `Tujuan berhenti dilacak. Saldo ${wallet} tidak berubah. Kamu bisa memulihkannya dari Selesai dan diarsipkan.`,
  archiveShared: (partner: string) => `Tujuan ini juga hilang dari Rencana ${partner}.`,
  archiveConfirm: 'Arsipkan',
  archivedToast: (name: string) => `Tujuan ${name} diarsipkan`,
  restore: 'Pulihkan',
  restoreLabel: (name: string) => `Pulihkan tujuan ${name}`,
  restoredToast: (name: string) => `Tujuan ${name} aktif lagi`,
  undoFailed: 'Belum bisa diurungkan. Muat ulang halaman, lalu coba lagi.',
} as const;
