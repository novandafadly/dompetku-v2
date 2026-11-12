import type { LedgerErrorCode } from '@/features/ledger/types';
import type { DebtDirection } from './types';

/**
 * Salinan galat Utang/Kontak (bingkai S11 "Salinan galat S11"): tanpa nominal, tanpa nama, tanpa
 * tanda seru, istilah `Utang`. Galat kolom `invalid` dan peringatan `saldo_negatif` (kotak
 * `warning-tint` dengan nominal dari data) dipilih UI per kolom, bukan di sini.
 */
export function utangFailedText(code: LedgerErrorCode, arah: DebtDirection = 'borrowed'): string {
  switch (code) {
    case 'payment_exceeds':
      return arah === 'lent'
        ? 'Jumlah ini lebih besar dari sisa. Kurangi jumlahnya atau terima sisanya.'
        : 'Jumlah ini lebih besar dari sisa. Kurangi jumlahnya atau bayar sisanya.';
    case 'payment_before_opened':
      return 'Tanggal ini sebelum utang dimulai. Pilih tanggal lain.';
    case 'debt_account_kantor':
      return 'Dompet Kantor tidak bisa dipakai untuk utang. Pilih dompet lain.';
    case 'debt_deleted':
      return 'Utang ini sudah dihapus. Pulihkan utangnya dulu.';
    case 'debt_principal_locked':
      return 'Pinjaman awal hanya bisa dibatalkan lewat Hapus utang.';
    case 'debt_personal_only':
      return 'Utang hanya bisa dicatat di Pribadi.';
    case 'not_found':
      return 'Data ini tidak ditemukan. Muat ulang halaman.';
    case 'contact_archived':
      return 'Kontak ini sudah diarsipkan. Pilih kontak lain.';
    case 'contact_name_taken':
      return 'Sudah ada kontak dengan nama ini.';
    case 'account_archived':
      return 'Dompet ini sudah diarsipkan. Pilih dompet lain.';
    case 'before_opening':
      return 'Tanggal ini sebelum dompet dibuka. Pilih tanggal lain.';
    case 'restore_window_closed':
      return 'Sudah lewat 90 hari, utang ini tidak bisa dipulihkan lagi.';
    case 'conflict':
      return 'Utang ini baru saja berubah. Muat ulang halaman.';
    default:
      return 'Belum berhasil. Sambungan ke server terputus. Coba lagi.';
  }
}

/** Pulihkan/Urungkan pembayaran atau utang yang ditolak (bingkai AK1/AK2). */
export function utangRestoreFailedText(code: LedgerErrorCode): string {
  switch (code) {
    case 'payment_exceeds':
      return 'Belum bisa dipulihkan. Sisa utangnya tidak cukup untuk pembayaran ini.';
    case 'saldo_negatif':
      return 'Belum bisa dipulihkan. Saldo dompet tidak cukup untuk mengembalikan pembayarannya.';
    default:
      return utangFailedText(code);
  }
}
