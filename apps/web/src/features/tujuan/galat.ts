import type { LedgerErrorCode } from '@/features/ledger/types';

/**
 * Salinan galat Tujuan (bingkai S13 "Salinan galat S13"): tanpa nominal, tanpa nama tujuan; nama
 * dompet hanya disusun klien dari data yang sudah dimuat. Galat kolom (`invalid`) dipilih UI per
 * kolom, bukan di sini.
 */
export function goalFailedText(code: LedgerErrorCode, wallet = 'Dompet ini'): string {
  switch (code) {
    case 'goal_exists':
      return `${wallet} sudah punya tujuan aktif. Selesaikan atau arsipkan tujuan itu dulu.`;
    case 'goal_pocket_invalid':
      return 'Hanya dompet tabungan yang bisa punya tujuan.';
    case 'account_archived':
      return 'Dompet ini sudah diarsipkan. Pilih dompet tabungan lain.';
    case 'goal_not_reached':
      return `Saldo ${wallet} sudah di bawah target lagi. Muat ulang halaman.`;
    case 'goal_not_active':
      return 'Tujuan ini sudah tidak aktif. Muat ulang halaman.';
    case 'goal_target_past':
      return 'Tanggal target tidak boleh sebelum hari ini.';
    case 'not_found':
      return 'Tujuan ini tidak ditemukan. Muat ulang halaman.';
    case 'idem_mismatch':
      return 'Permintaan ini bentrok dengan yang sebelumnya. Muat ulang halaman, lalu coba lagi.';
    default:
      return 'Belum berhasil. Sambungan ke server terputus. Coba lagi.';
  }
}

/** `Pulihkan` yang ditolak: teks di baris (TJ8). */
export function goalRestoreFailedText(code: LedgerErrorCode, wallet: string): string {
  return code === 'account_archived' ? 'Dompet sudah diarsipkan' : goalFailedText(code, wallet);
}

export const FIELD_NAME = 'Nama tujuan wajib diisi, paling banyak 60 huruf.';
export const FIELD_TARGET = 'Target harus lebih dari nol dan masuk akal.';
export const FIELD_DATE = 'Tanggal target tidak valid.';
