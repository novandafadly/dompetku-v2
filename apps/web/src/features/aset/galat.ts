import type { LedgerErrorCode } from '@/features/ledger/types';

/**
 * Salinan galat Aset (bingkai S14 "Salinan galat S14"): tanpa nominal; nama aset hanya disusun klien
 * dari data yang sudah dimuat. Galat kolom (`invalid`) dipilih UI per kolom, bukan di sini.
 */
export function assetFailedText(code: LedgerErrorCode, asset = 'Aset ini'): string {
  switch (code) {
    case 'asset_negative':
      return `Nilai ${asset} tidak cukup. Aset tidak bisa minus.`;
    case 'pocket_personal_only':
      return 'Saham hanya bisa dicatat di Pribadi.';
    case 'account_archived':
      return `${asset} sudah diarsipkan.`;
    case 'before_latest_entry':
      return `Tanggalnya lebih awal dari transaksi terakhir ${asset}. Pilih tanggal yang sama atau lebih baru.`;
    case 'before_opening':
      return `Tanggalnya lebih awal dari nilai awal ${asset}.`;
    case 'stock_account_trade_only':
      return 'Dompet saham hanya berubah lewat Beli atau Jual saham.';
    case 'asset_account_invalid':
    case 'not_found':
      return 'Aset ini tidak ditemukan. Muat ulang halaman.';
    case 'name_taken':
      return 'Nama ini sudah dipakai.';
    case 'idem_mismatch':
      return 'Permintaan ini bentrok dengan yang sebelumnya. Muat ulang halaman, lalu coba lagi.';
    default:
      return 'Belum berhasil. Sambungan ke server terputus. Coba lagi.';
  }
}

export const FIELD_KIND = 'Pilih jenis aset.';
export const FIELD_NAME = 'Nama aset wajib diisi, paling banyak 60 huruf.';
export const FIELD_VALUE = 'Nilai tidak boleh minus.';
/** Batas `private.check_amount` (10^13), pola `rencana/copy.ts` `errAmountMax`. */
export const FIELD_VALUE_MAX = 'Nilai terlalu besar. Maksimal Rp 10.000.000.000.000.';
export const FIELD_DATE = 'Tanggal tidak boleh setelah hari ini.';
/** Batas bawah tanggal DB (`private.check_date`): aset lama boleh dicatat sejak 2000. */
export const ASSET_MIN_DATE = '2000-01-01';
export const FIELD_DATE_RANGE = 'Tanggal harus antara 1 Januari 2000 dan hari ini.';
/** Nama bentrok dengan dompet atau aset lain di ruang itu. */
export const nameTaken = (name: string, ruangName: string) =>
  `Dompet atau aset bernama ${name} sudah ada di ${ruangName}.`;
