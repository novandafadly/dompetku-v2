import type { LedgerErrorCode } from '@/features/ledger/types';

/**
 * Salinan galat saham (bingkai S14 "Salinan galat S14"): tanpa nominal, tanpa kode saham dari DB.
 * Galat kolom (`invalid`, `insufficient_shares`, `price_spike_unconfirmed`) dipilih UI per kolom;
 * di sini kalimat untuk kotak atas sheet/dialog.
 */
export function stockFailedText(code: LedgerErrorCode): string {
  switch (code) {
    case 'not_found':
      return 'Saham ini tidak ditemukan. Muat ulang halaman.';
    case 'trade_not_latest':
      return 'Sudah ada transaksi yang lebih baru. Muat ulang halaman.';
    case 'asset_negative':
      return 'Transaksi ini belum bisa dibatalkan. Muat ulang halaman.';
    case 'account_archived':
      return 'Dompet ini sudah diarsipkan. Pilih dompet lain.';
    case 'asset_account_invalid':
      return 'Dompet ini tidak bisa dipakai untuk saham. Pilih dompet lain.';
    case 'pocket_personal_only':
      return 'Saham hanya bisa dicatat di Pribadi.';
    case 'stock_account_trade_only':
      return 'Dompet saham hanya berubah lewat Beli atau Jual saham.';
    case 'conflict':
    case 'idem_mismatch':
      return 'Permintaan ini bentrok dengan yang sebelumnya. Muat ulang halaman, lalu coba lagi.';
    case 'restore_window_closed':
      return 'Sudah terlalu lama dibatalkan. Transaksi ini tidak bisa dipulihkan.';
    default:
      return 'Belum berhasil. Sambungan ke server terputus. Coba lagi.';
  }
}

export const FIELD_TICKER = 'Kode saham terdiri dari 4 huruf, misalnya BBCA.';
export const FIELD_SHARES = 'Isi jumlah bulat, paling sedikit 1.';
export const FIELD_SHARES_OVER = 'Jumlahnya melebihi saham yang dimiliki.';
export const FIELD_PRICE = 'Harga harus angka bulat lebih dari nol dan masuk akal.';
export const FIELD_AMOUNT = 'Total terlalu besar. Periksa jumlah dan harganya.';
export const FIELD_DATE = 'Tanggal tidak boleh setelah hari ini.';
export const FIELD_CASH = 'Pilih dompet.';
export const FIELD_DATE_EARLY =
  'Tanggalnya lebih awal dari transaksi atau dompet yang sudah ada. Pilih tanggal yang sama atau lebih baru.';
