import type { LedgerErrorCode, Ruang } from '@/features/ledger/types';

/**
 * Salinan galat S15 (tanpa nominal, tanpa nama dari DB — `{nama}` dan `{Ruang}` dari klien).
 * Sumber: `docs/design/s15-bingkai.md` "Salinan galat S15".
 */

const RUANG_NAME: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

export const FIELD_NAME = 'Nama trip wajib diisi, paling banyak 60 huruf.';
export const FIELD_STARTS_ON = 'Isi tanggal mulai yang valid.';
export const FIELD_ENDS_ON_EMPTY = 'Isi tanggal selesai.';
export const FIELD_ENDS_ON_BEFORE = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
export const FIELD_ENDS_ON_TOO_LONG = 'Rentang trip paling lama 366 hari.';
export const FIELD_ENDS_ON_SERVER =
  'Tanggal selesai tidak valid. Paling lama 366 hari sesudah tanggal mulai.';
export const FIELD_BUDGET = 'Anggaran harus lebih dari nol dan masuk akal.';

export const NETWORK_ERROR = 'Belum berhasil. Sambungan ke server terputus. Coba lagi.';
export const TRIP_NOT_FOUND = 'Trip ini tidak ditemukan. Muat ulang halaman.';
export const TRIP_ARCHIVED_SHEET = 'Trip ini sudah diarsipkan. Muat ulang halaman.';
export const TRIP_ARCHIVED_UNDO =
  'Trip ini sudah diarsipkan. Pulihkan dulu untuk memasukkannya lagi.';
export const TRIP_ENTRY_INVALID_IMPORT =
  'Ada pengeluaran yang tidak bisa masuk trip lagi. Muat ulang halaman, lalu coba lagi.';
export const TRIP_SPLIT_LOCKED = 'Pengeluaran ini dikelola dari halaman Patungan.';
export const TRIP_LIMIT = 'Jumlah trip di ruang ini sudah mencapai batas.';
export const TRIP_CONFLICT = 'Entri ini baru saja berubah. Muat ulang.';

export function nameTakenText(name: string, ruang: Ruang): string {
  return `Sudah ada trip aktif bernama ${name} di ${RUANG_NAME[ruang]}.`;
}

export function restoreNameTakenText(name: string): string {
  return `Sudah ada trip aktif bernama ${name}. Ubah nama trip yang aktif dulu, lalu pulihkan.`;
}

/** Galat untuk sheet Tambah/Ubah trip atau dialog Arsipkan. */
export function tripFailedText(code: LedgerErrorCode, name = '', ruang: Ruang = 'pribadi'): string {
  switch (code) {
    case 'name_taken':
      return nameTakenText(name, ruang);
    case 'not_found':
      return TRIP_NOT_FOUND;
    case 'trip_archived':
      return TRIP_ARCHIVED_SHEET;
    case 'trip_limit':
      return TRIP_LIMIT;
    case 'conflict':
      return TRIP_CONFLICT;
    case 'network':
    case 'unknown':
    default:
      return NETWORK_ERROR;
  }
}

/** Galat tombol `Pulihkan` pada baris terarsip atau banner Detail. */
export function tripRestoreFailedText(code: LedgerErrorCode, name: string): string {
  switch (code) {
    case 'name_taken':
      return restoreNameTakenText(name);
    case 'not_found':
      return TRIP_NOT_FOUND;
    case 'network':
    case 'unknown':
    default:
      return NETWORK_ERROR;
  }
}

/** Galat sheet `Masukkan {n} pengeluaran`. */
export function tripImportFailedText(code: LedgerErrorCode): string {
  switch (code) {
    case 'trip_entry_invalid':
      return TRIP_ENTRY_INVALID_IMPORT;
    case 'trip_archived':
      return TRIP_ARCHIVED_SHEET;
    case 'not_found':
      return TRIP_NOT_FOUND;
    case 'split_locked':
      return TRIP_SPLIT_LOCKED;
    case 'conflict':
      return TRIP_CONFLICT;
    case 'network':
    case 'unknown':
    default:
      return NETWORK_ERROR;
  }
}

/** Galat tombol `Keluarkan` atau `Urungkan` Keluarkan/Masukkan. */
export function tripEntryActionFailedText(code: LedgerErrorCode, forUndo = false): string {
  switch (code) {
    case 'trip_archived':
      return forUndo ? TRIP_ARCHIVED_UNDO : TRIP_ARCHIVED_SHEET;
    case 'split_locked':
      return TRIP_SPLIT_LOCKED;
    case 'not_found':
      return TRIP_NOT_FOUND;
    case 'conflict':
      return TRIP_CONFLICT;
    case 'trip_entry_invalid':
      return TRIP_ENTRY_INVALID_IMPORT;
    case 'network':
    case 'unknown':
    default:
      return NETWORK_ERROR;
  }
}
