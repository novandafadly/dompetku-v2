import type { LedgerErrorCode } from '@/features/ledger/types';

/**
 * Salinan galat Patungan (bingkai S12 "Salinan galat S12"): tanpa nominal, tanpa nama, tanpa tanda
 * seru. `saldo_negatif` (kotak `warning-tint` dengan nominal dari data) dipilih UI per tempat,
 * bukan di sini.
 */
export function patunganFailedText(code: LedgerErrorCode): string {
  switch (code) {
    case 'payment_exceeds':
      return 'Jumlah ini lebih besar dari utangmu. Kurangi jumlahnya.';
    case 'settlement_received':
      return 'Sudah diterima. Minta penerima membatalkan penerimaannya dulu.';
    case 'settlement_voided':
      return 'Pelunasan ini sudah dibatalkan. Muat ulang halaman.';
    case 'settlement_not_received':
      return 'Pelunasan ini belum diterima. Muat ulang halaman.';
    case 'split_needs_partner':
    case 'split_shared_only':
      return 'Patungan butuh dua anggota di Bersama.';
    case 'split_locked':
      return 'Ini bagian dari patungan. Ubah atau hapus dari halaman Patungan.';
    case 'split_account_invalid':
      return 'Dompet ini tidak bisa dipakai di sini. Pilih dompet lain.';
    case 'split_member_left':
      return 'Anggota yang punya bagian di tagihan ini sudah keluar dari Bersama.';
    case 'account_archived':
      return 'Dompet ini sudah diarsipkan. Pilih dompet lain.';
    case 'before_opening':
      return 'Tanggal ini sebelum dompet dibuka. Pilih tanggal lain.';
    case 'restore_window_closed':
      return 'Sudah lewat 90 hari, tagihan ini tidak bisa dipulihkan lagi.';
    case 'category_archived':
      return 'Kategori ini sudah diarsipkan. Pilih kategori lain.';
    case 'conflict':
    case 'not_found':
      return 'Data ini tidak ditemukan. Muat ulang halaman.';
    default:
      return 'Belum berhasil. Sambungan ke server terputus. Coba lagi.';
  }
}

/** Pulihkan/Urungkan yang ditolak. */
export function patunganRestoreFailedText(code: LedgerErrorCode): string {
  return code === 'saldo_negatif'
    ? 'Belum bisa dipulihkan. Saldo dompet tidak cukup untuk mengembalikan pembayarannya.'
    : patunganFailedText(code);
}
