import type { IsoDate, Rupiah } from '@dompetku/domain';
import type { AccountVM, CategoryVM, LedgerErrorCode, Ruang } from '@/features/ledger/types';

/**
 * Sumber data sheet Catat. Prototipe memakai `demoCatatSource` (store demo, sinkron dibungkus
 * `Promise.resolve`); mode nyata memakai `realCatatSource` (Server Action) di `app/[ruang]/_real`.
 * Sheet dan `useCatat` hanya mengenal antarmuka ini.
 */

export type CatatType = 'expense' | 'income' | 'transfer';

export interface CatatDraft {
  type: CatatType;
  amount: Rupiah | null;
  categoryId?: string;
  accountId: string;
  /** Hanya transfer: dompet tujuan di ruang yang sama. */
  counterAccountId?: string;
  date: IsoDate;
  /**
   * Tanggal dipilih pengguna. Bila tidak, sumber nyata tidak mengirim `occurredOn` sehingga server
   * memakai `app.today()` (tanggal klien bisa basi bila sheet dibuka melewati tengah malam WIB).
   */
  dateChosen: boolean;
  description?: string;
  ruang: Ruang;
  /** Kunci idempoten (UUID v4): lahir saat sheet dibuka, tetap sama saat "Coba lagi". */
  clientId: string;
}

export interface CatatOptions {
  accounts: AccountVM[];
  categories: CategoryVM[];
  /** Dompet bawaan (operasional terakhir dipakai); bila kosong, operasional pertama. */
  defaultAccountId?: string;
}

export type SaveOutcome =
  | { ok: true; entryId: string; version: number; replayed: boolean; toast: string }
  | { ok: false; code: LedgerErrorCode; field?: string };

export type CatatStatus =
  'idle' | 'menyimpan' | 'galat' | 'saldo_kurang' | 'idem_mismatch' | 'field';

/**
 * Event produk Catat dari sheet ke sumber. Hanya penanda alur: tanpa nominal, deskripsi, atau id
 * entri/kategori/dompet. `ruang` = ruang sheet saat event terjadi (server menurunkan `space_kind`).
 */
export type CatatTrackEvent =
  | { event: 'catat_dibuka'; ruang: Ruang; flowId: string }
  | {
      event: 'catat_disimpan' | 'catat_batal';
      ruang: Ruang;
      flowId: string;
      taps: number;
      durationMs: number;
    };

export interface CatatSource {
  ruangLabel: Record<Ruang, string>;
  options(ruang: Ruang): CatatOptions | Promise<CatatOptions>;
  /** 6 kategori saran; dipanggil sekali per (ruang, jenis) selama sheet terbuka. */
  chips(
    ruang: Ruang,
    type: 'income' | 'expense',
    hour: number,
  ): CategoryVM[] | Promise<CategoryVM[]>;
  save(draft: CatatDraft & { allowNegative: boolean }): Promise<SaveOutcome>;
  undo(saved: { entryId: string; version: number; ruang: Ruang }): Promise<boolean>;
  /** Event produk; kirim-dan-lupakan, tidak pernah melempar. Prototipe tidak menulis apa pun. */
  track?(e: CatatTrackEvent): void;
}

/** Bentuk `then` cukup untuk membedakan hasil sinkron (prototipe) dari Promise (nyata). */
export function isPromise<T>(v: T | Promise<T>): v is Promise<T> {
  return typeof (v as { then?: unknown } | null)?.then === 'function';
}
