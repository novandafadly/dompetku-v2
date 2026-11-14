import type { IsoDate, Rupiah } from '@dompetku/domain';

/**
 * View-model bagi tagihan Bersama / patungan (S12; bingkai PT1 sampai PT4, CT1, CT2, AK1, AK2).
 * Semua angka dari SQL (`api.shared_balances`, `api.split_history`, hasil fungsi tulis); UI hanya
 * menyusun kalimat. Tanpa id/nama dompet Pribadi kecuali milik penonton sendiri (`wallet`).
 */

/** Anggota patungan (Bersama dua anggota): id dan nama untuk kalimat saldo dan pembagian. */
export interface SplitPersonVM {
  id: string;
  name: string;
  initial: string;
}

/** Konteks Catat Bersama: penonton dan anggota lain; hanya ada bila Bersama berisi dua anggota. */
export interface SplitContextVM {
  me: SplitPersonVM;
  partner: SplitPersonVM;
}

/** Pelunasan hidup yang belum diterima (`api.shared_balances.pending`). */
export interface PendingSettlementVM {
  id: string;
  fromId: string;
  toId: string;
  amount: Rupiah;
  occurredOn: IsoDate;
}

/**
 * Saldo patungan (`api.shared_balances`). `debtorId`/`creditorId`/`amount` semuanya `null` = impas
 * (tidak ada kalimat arah, tidak ada `Rp 0`).
 */
export interface SplitBalanceVM {
  me: SplitPersonVM;
  partner: SplitPersonVM;
  debtorId: string | null;
  creditorId: string | null;
  amount: Rupiah | null;
  splitCount: number;
  settlementCount: number;
  pending: PendingSettlementVM[];
}

/** Dompet Pribadi milik penonton yang terkait satu baris riwayat (hanya untuk pemiliknya). */
export interface SplitWalletVM {
  name: string;
  /** Saldo sekarang (SQL), untuk `KolomKas` dialog akibat. */
  balance: Rupiah;
}

export interface SplitShareVM {
  userId: string;
  amount: Rupiah;
}

interface SplitHistoryBase {
  id: string;
  occurredOn: IsoDate;
  /** ISO WIB (`+07:00`); kunci urut stabil bersama `id`. */
  createdAt: string;
  amount: Rupiah;
  /** Baris dihapus/dibatalkan; hanya milik penonton, ≤ 90 hari. */
  voidedAt: string | null;
  purgeAfter: string | null;
}

export interface SplitBillVM extends SplitHistoryBase {
  item: 'split';
  payerId: string;
  description: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  /** Entri pengeluaran Bersama (tautan ke Detail transaksi). */
  expenseEntryId: string;
  shares: SplitShareVM[];
}

export interface SplitSettlementVM extends SplitHistoryBase {
  item: 'settlement';
  fromId: string;
  toId: string;
  received: boolean;
}

export type SplitHistoryItemVM = SplitBillVM | SplitSettlementVM;

/** Kursor halaman riwayat (urutan `occurred_on, created_at, id` menurun). */
export interface SplitCursor {
  on: IsoDate;
  /** `YYYY-MM-DDTHH:MM:SS.ffffffZ` (UTC, mikrodetik). */
  at: string;
  id: string;
}

export interface PatunganData {
  /** `null` = Bersama solo (butuh dua anggota). */
  balance: SplitBalanceVM | null;
  /** Hidup, terbaru di atas. */
  history: SplitHistoryItemVM[];
  /** Dihapus penonton, ≤ 90 hari (grup `Patungan dihapus`). */
  deleted: SplitHistoryItemVM[];
  /** Kursor halaman berikutnya; `null` bila tidak ada lagi. */
  next: SplitCursor | null;
}

/**
 * Dompet Pribadi penonton, dimuat malas lewat action saat sheet/dialog pertama dibuka (R27: data
 * Pribadi tidak lewat props rute Bersama). `linked` = dompet Pribadi yang tersentuh baris
 * patungan miliknya (id baris tagihan/pelunasan): sumber kalimat dialog akibat.
 */
export interface PatunganWalletsVM {
  accounts: SplitPayerAccountVM[];
  linked: Record<string, SplitWalletVM>;
}

/** Dompet Pribadi pemanggil yang boleh membayar/menerima patungan (operasional/tabungan). */
export interface SplitPayerAccountVM {
  id: string;
  name: string;
  balance: Rupiah;
  pocket: 'operasional' | 'tabungan';
}

/** Hasil tulis yang dipakai UI (nominal bagian dari SQL). */
export interface CreateSplitResultVM {
  splitId: string;
  expenseEntryId: string;
  amount: Rupiah;
  shares: SplitShareVM[];
  replayed: boolean;
}

export interface SettleResultVM {
  settlementId: string;
  amount: Rupiah;
  /** Sisa utang ke penerima sesudah pelunasan ini (SQL). */
  remaining: Rupiah;
  replayed: boolean;
}

export interface SplitEffectVM {
  accountName: string;
  amount: Rupiah;
}
