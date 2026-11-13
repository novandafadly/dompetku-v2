import type { IsoDate, Rupiah } from '@dompetku/domain';

/**
 * View-model Utang dan Kontak (S11, bingkai `docs/design/s11-bingkai.md`). Dirangkai di server
 * (`server/ledger/utang.ts`) dari ruang Pribadi saja; semua angka uang dari SQL (`api.list_debts`,
 * `api.debt_detail`, `api.list_contacts`, balasan `api.pay_debt` …). UI hanya membandingkan dan
 * memformat (pratinjau `KolomKas` boleh satu pengurangan, hasil sesudah simpan dari SQL).
 * Stempel waktu = ISO WIB `YYYY-MM-DDTHH:MM:SS+07:00`.
 */

/** `borrowed` = Saya berutang; `lent` = Piutang. */
export type DebtDirection = 'borrowed' | 'lent';
/** `baru` = uang pinjaman masuk/keluar dompet (entri pokok); `berjalan` = sisa saat ini, tanpa efek kas (K2). */
export type DebtMode = 'baru' | 'berjalan';

/** Pintasan sheet Bayar: 25%/50% dari SISA (dibulatkan ke bawah, `null` = 0, chip disembunyikan); `full` = sisa. */
export interface DebtQuickVM {
  p25: Rupiah | null;
  p50: Rupiah | null;
  full: Rupiah;
}

/** Angka satu utang (SQL). Utang terhapus: angka sesudah dipulihkan. */
export interface DebtNumbersVM {
  principal: Rupiah;
  paid: Rupiah;
  remaining: Rupiah;
  /** floor(paid × 100 / principal): tidak pernah 100 sebelum lunas. */
  paidPct: number;
  settled: boolean;
  quick: DebtQuickVM;
}

/** Satu baris `api.list_debts` (hidup + terhapus ≤ 90 hari; urutan SQL dipertahankan). */
export interface DebtListItemVM extends DebtNumbersVM {
  debtId: string;
  contactId: string;
  contactName: string;
  direction: DebtDirection;
  mode: DebtMode;
  title: string | null;
  openedOn: IsoDate;
  /** Dompet entri pokok (mode baru); `null` untuk berjalan. */
  accountId: string | null;
  /** Utang dihapus (grup `Utang dihapus`); `null` = hidup. */
  voidedAt: string | null;
}

/** Kartu `Sisa` per arah (utang hidup bersisa; SQL). `remaining` 0 = baris tidak dirender. */
export interface DebtTotalVM {
  remaining: Rupiah;
  contacts: number;
}

export interface UtangData {
  debts: DebtListItemVM[];
  totals: Record<DebtDirection, DebtTotalVM>;
  /** Kontak aktif (pemilih di sheet Tambah/Ubah), urut nama. */
  contacts: ContactVM[];
}

/** Kontak aktif + ringkasan sisa per arah (`api.list_contacts`). */
export interface ContactVM {
  contactId: string;
  name: string;
  borrowedRemaining: Rupiah;
  lentRemaining: Rupiah;
  /** Jumlah utang aktif (bukan uang). */
  borrowedCount: number;
  lentCount: number;
}

/** Efek per dompet (Hapus/Pulihkan utang); tanpa baris nol; tanda = perubahan saldo. */
export interface DebtEffectVM {
  accountId: string;
  accountName: string;
  amount: Rupiah;
}

/** Satu cicilan di riwayat (termasuk yang dibatalkan), terbaru dulu. `amount` positif. */
export interface DebtPaymentVM {
  entryId: string;
  version: number;
  occurredOn: IsoDate;
  accountId: string;
  accountName: string;
  amount: Rupiah;
  voided: boolean;
  voidedAt: string | null;
  /** Dibatalkan oleh Hapus utang (bukan sendiri). */
  voidedWithDebt: boolean;
  createdAt: string;
}

export interface DebtDetailVM extends DebtNumbersVM {
  debtId: string;
  contactId: string;
  contactName: string;
  contactArchived: boolean;
  direction: DebtDirection;
  mode: DebtMode;
  title: string | null;
  note: string | null;
  openedOn: IsoDate;
  createdAt: string;
  /** Entri pokok dan dompetnya (mode baru); `null` untuk berjalan. */
  principalEntryId: string | null;
  accountId: string | null;
  accountName: string | null;
  payments: DebtPaymentVM[];
  /** Efek bersih per dompet bila utang dihapus sekarang (dialog AK2). */
  voidEffects: DebtEffectVM[];
}

/** Bagian utang yang dipakai sheet Bayar: daftar dan detail sama-sama memenuhinya. */
export interface PayTarget {
  debtId: string;
  contactName: string;
  direction: DebtDirection;
  principal: Rupiah;
  remaining: Rupiah;
  quick: DebtQuickVM;
  openedOn: IsoDate;
  /** Dompet entri pokok (mode baru): bawaan dompet bayar bila masih aktif. */
  accountId: string | null;
}
