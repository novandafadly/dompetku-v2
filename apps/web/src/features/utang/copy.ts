import { formatRupiah, shortDateLabel, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { DebtDirection } from './types';

/**
 * Salinan UI Utang dan Kontak (S11, bingkai `docs/design/s11-bingkai.md` "Salinan final").
 * Hanya mode nyata dan ruang Pribadi: ruang tidak diparameterkan kecuali di judul sheet/toast, jadi
 * kata `Pribadi` tertulis literal. Istilah baku `Utang` (bukan "Hutang"); tanpa tanda seru; galat
 * tanpa nominal (nominal yang tampil di sini selalu data, bukan pesan galat).
 */

const SPACE = 'Pribadi';

export const UTANG_COPY = {
  // Daftar (UT1)
  segment: 'Utang',
  borrowed: 'Saya berutang',
  lent: 'Piutang',
  remaining: 'Sisa',
  contactsCount: (n: number) => `${String(n)} kontak`,
  remainingOf: 'Sisa',
  pay: 'Bayar',
  receive: 'Terima',
  settled: 'Lunas',
  settledGroup: (n: number) => `Lunas (${String(n)})`,
  deletedGroup: (n: number) => `Utang dihapus (${String(n)})`,
  deletedOn: (tgl: string) => `Dihapus ${tgl}`,
  restore: 'Pulihkan',
  add: 'Tambah utang',
  emptyTitle: 'Belum ada utang atau piutang.',
  emptyDescription:
    'Catat uang yang kamu pinjam atau pinjamkan, lalu cicilannya, supaya sisanya selalu jelas.',
  loading: 'Memuat utang…',
  failedTitle: 'Utang belum bisa dimuat.',
  failedDescription: 'Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang.',
  restoredFailedHint: 'Belum bisa dipulihkan.',
  // Detail (DT1)
  detailBack: 'Utang',
  amountLabel: 'Sisa',
  payDebt: 'Bayar utang',
  receivePayment: 'Terima pembayaran',
  edit: 'Ubah',
  deleteDebt: 'Hapus utang',
  details: 'Rincian',
  directionLabel: 'Arah',
  contactLabel: 'Kontak',
  recordedAs: 'Dicatat sebagai',
  modeNew: 'Uang baru',
  modeRunning: 'Sudah berjalan',
  modeRunningNote: 'Saldo dompet tidak ikut berubah.',
  walletLabel: 'Dompet',
  noteLabel: 'Catatan',
  history: 'Riwayat pembayaran',
  cancelled: 'Dibatalkan',
  cancel: 'Batalkan',
  noPayments: 'Belum ada pembayaran.',
  detailLoading: 'Memuat utang…',
  // Ubah (DT2)
  editTitle: 'Ubah utang',
  editIntro: 'Perubahan ini tidak mengubah saldo, pembayaran, atau sisa.',
  titleField: 'Untuk apa',
  titlePlaceholder: 'Mis. cicilan motor',
  noteField: 'Catatan',
  editLocked:
    'Jumlah dan pembayaran tidak bisa diubah. Batalkan pembayarannya atau hapus utang ini, lalu catat ulang.',
  saveChanges: 'Simpan perubahan',
  // Tambah (AD1)
  addTitle: 'Tambah utang',
  directionField: 'Arah',
  borrowedHint: 'Kamu meminjam uang dari orang lain.',
  lentHint: 'Kamu meminjamkan uang ke orang lain.',
  contactField: 'Kontak',
  newContact: 'Tambah kontak baru',
  pickContact: 'Pilih dari daftar',
  contactName: 'Nama kontak',
  modeField: 'Cara mencatat',
  modeNewShort: 'Baru',
  modeRunningShort: 'Sudah berjalan',
  runningHint: 'Hanya mencatat sisa saat ini. Saldo dompet dan Laporan tidak berubah.',
  principalNew: 'Jumlah pinjaman',
  principalRunning: 'Sisa saat ini',
  accountIn: 'Uang masuk ke',
  accountOut: 'Uang keluar dari',
  accountPlain: 'Dompet',
  dateNew: 'Tanggal',
  dateRunning: 'Utang mulai',
  save: 'Simpan utang',
  saveAnyway: 'Tetap simpan',
  noAccountAdd: 'Belum ada dompet di Pribadi. Tambah dompet dulu, atau pilih Sudah berjalan.',
  // Bayar (BY1)
  amountPaid: 'Jumlah dibayar',
  amountReceived: 'Jumlah diterima',
  quickLabel: 'Pintasan jumlah',
  quickFull: 'Lunas',
  paidFrom: 'Dibayar dari',
  receivedIn: 'Diterima di',
  datePaid: 'Tanggal bayar',
  dateReceived: 'Tanggal terima',
  after: 'Setelah ini',
  remainingNow: 'Sisa sekarang',
  remainingAfter: 'Sisa sesudahnya',
  payAnyway: 'Tetap bayar',
  noAccountPay: 'Belum ada dompet di Pribadi. Tambah dompet dulu untuk membayar.',
  addAccount: 'Tambah dompet',
  paidOffNote: 'Utang ini sudah lunas atau dihapus. Muat ulang halaman.',
  reload: 'Muat ulang',
  retry: 'Coba lagi',
  // Dialog (AK1/AK2)
  now: 'Sekarang',
  afterwards: 'Sesudahnya',
  cancelPaymentTitle: 'Batalkan pembayaran ini?',
  cancelPayment: 'Batalkan pembayaran',
  back: 'Kembali',
  debtBalanceTitle: 'Sisa utang',
  deleteTitle: (nama: string) => `Hapus utang ke ${nama}?`,
  deleteTitleLent: (nama: string) => `Hapus piutang pada ${nama}?`,
  deleteBody:
    'Utang ini dan semua pembayarannya dibatalkan sekaligus. Bisa dipulihkan 90 hari dari Utang dihapus.',
  deleteEffects: 'Saldo dompet berubah',
  deleteNoEffects: 'Saldo dompet tidak berubah.',
  deleteGone: (nama: string) => `Sisa utang ke ${nama} menjadi tidak ada.`,
  deleteGoneLent: (nama: string) => `Sisa piutang pada ${nama} menjadi tidak ada.`,
  undo: 'Urungkan',
  undoFailed: 'Belum bisa diurungkan. Buka Utang untuk memulihkannya.',
  undoCancelFailed:
    'Belum bisa diurungkan. Sisa utangnya tidak cukup atau pembayaran sudah berubah.',
  // Kontak (KT1/KT2)
  contactsTitle: 'Kontak',
  addContact: 'Tambah kontak',
  editContact: 'Ubah kontak',
  contactEmptyTitle: 'Belum ada kontak.',
  contactEmptyDescription: 'Kontak dibuat saat kamu mencatat utang, atau dari sini.',
  contactsLoading: 'Memuat kontak…',
  contactsFailedTitle: 'Kontak belum bisa dimuat.',
  contactsFailedDescription: 'Periksa koneksi lalu coba lagi.',
  noActiveDebt: 'Tidak ada utang aktif',
  nameField: 'Nama',
  renameHint: 'Nama baru berlaku di semua utang kontak ini.',
  activeCount: (n: number, m: number) => `Utang aktif ${String(n)} · Piutang aktif ${String(m)}`,
  archiveContact: 'Arsipkan kontak',
  archiveTitle: (nama: string) => `Arsipkan ${nama}?`,
  archiveBody: (nama: string) =>
    `${nama} tidak muncul lagi di pilihan kontak. Utang yang sudah ada tetap tercatat dan tetap bisa dibayar.`,
  archive: 'Arsipkan',
  archived: (nama: string) => `${nama} diarsipkan`,
  // Galat kolom
  errDirection: 'Pilih arah utang.',
  errContact: 'Pilih kontak atau tambah kontak baru.',
  errContactName: 'Nama kontak diisi 1 sampai 60 huruf.',
  errContactNameTaken: 'Sudah ada kontak dengan nama ini. Pilih dari daftar.',
  errAmount: 'Jumlah harus lebih dari nol.',
  errAccount: 'Pilih dompet.',
  errExceeds: (arah: DebtDirection) =>
    arah === 'lent'
      ? 'Jumlah ini lebih besar dari sisa. Kurangi jumlahnya atau terima sisanya.'
      : 'Jumlah ini lebih besar dari sisa. Kurangi jumlahnya atau bayar sisanya.',
  errAmountMax: 'Jumlah terlalu besar. Maksimal Rp 10.000.000.000.000.',
  errDateFuture: 'Tanggal tidak boleh sesudah hari ini.',
  errIdem:
    'Isian ini sudah pernah terkirim dengan isi berbeda. Periksa daftar Utang sebelum menyimpan lagi.',
  errInvalid: 'Isian belum lengkap. Periksa lagi lalu simpan.',
  errNetwork: 'Belum berhasil. Sambungan ke server terputus. Coba lagi.',
} as const;

/** Judul halaman dan kalimat: `Utang ke {nama}` / `Piutang pada {nama}`. */
export function debtHeading(direction: DebtDirection, nama: string): string {
  return direction === 'lent' ? `Piutang pada ${nama}` : `Utang ke ${nama}`;
}

export function directionName(direction: DebtDirection): string {
  return direction === 'lent' ? UTANG_COPY.lent : UTANG_COPY.borrowed;
}

/** `14 Okt 2026`. */
export function dateWithYear(d: IsoDate): string {
  return `${shortDateLabel(d)} ${d.slice(0, 4)}`;
}

/** Nama aksesibel tombol baris: diawali kata terlihat (Label in Name). */
export function payRowLabel(direction: DebtDirection, nama: string): string {
  return direction === 'lent' ? `Terima dari ${nama}` : `Bayar utang ke ${nama}`;
}

export function savedInfoToast(nama: string, direction: DebtDirection): string {
  return `${debtHeading(direction, nama)} disimpan · ${SPACE}`;
}

/** Toast sesudah Tambah; `account` hanya mode baru. */
export function addedToast(
  nama: string,
  direction: DebtDirection,
  mode: 'baru' | 'berjalan',
  amount: Rupiah,
  account: string,
): string {
  const head = `${debtHeading(direction, nama)} dicatat di ${SPACE}`;
  if (mode === 'berjalan') return `${head} · saldo tidak berubah`;
  return direction === 'lent'
    ? `${head} · ${formatRupiah(amount)} keluar dari ${account}`
    : `${head} · ${formatRupiah(amount)} masuk ke ${account}`;
}

/** Toast sesudah Bayar/Terima; `remaining` dari balasan SQL. */
export function paidToast(
  nama: string,
  direction: DebtDirection,
  amount: Rupiah,
  account: string,
  remaining: Rupiah,
): string {
  if (remaining === 0) {
    return direction === 'lent'
      ? `Piutang pada ${nama} lunas · ${formatRupiah(amount)} di ${account}`
      : `Utang ke ${nama} lunas · ${formatRupiah(amount)} dari ${account}`;
  }
  return direction === 'lent'
    ? `Diterima dari ${nama} · ${formatRupiah(amount)} di ${account} · sisa ${formatRupiah(remaining)}`
    : `Dibayar ke ${nama} · ${formatRupiah(amount)} dari ${account} · sisa ${formatRupiah(remaining)}`;
}

export function cancelledToast(amount: Rupiah): string {
  return `Pembayaran dibatalkan · ${SPACE} · ${formatRupiah(amount)}`;
}

export function deletedToast(nama: string, direction: DebtDirection): string {
  return `${debtHeading(direction, nama)} dihapus di ${SPACE}`;
}

export function restoredToast(nama: string, direction: DebtDirection): string {
  return `${debtHeading(direction, nama)} dipulihkan di ${SPACE}`;
}

export function sheetTitle(base: string): string {
  return `${base} · ${SPACE}`;
}

export function paySheetTitle(direction: DebtDirection, nama: string): string {
  return direction === 'lent'
    ? `Terima dari ${nama} · ${SPACE}`
    : `Bayar utang ke ${nama} · ${SPACE}`;
}

/** Peringatan saldo kurang (nominal sah: data dompet, bukan pesan galat server). */
export function saldoWarning(
  account: string,
  balance: Rupiah,
  after: Rupiah,
  verb: 'dibayar' | 'disimpan',
): string {
  return `Saldo ${account} tinggal ${formatRupiah(balance)}. Kalau ${verb}, saldonya jadi ${formatRupiah(after)}.`;
}
