import type { IsoDate, Rupiah } from '@dompetku/domain';
import type { AccountVM, CategoryVM, PeriodVM } from '@/features/ledger/types';

/**
 * View-model Rencana (S9: anggaran per kategori induk dan tagihan rutin dasar). Dirangkai di server
 * (`server/ledger/rencana.ts`) dari ruang ini saja dan diserialisasi ke payload RSC: Rencana
 * Bersama tidak pernah memuat tagihan, anggaran, kategori, atau dompet Pribadi (B13). Semua angka
 * uang dari SQL (`api.budget_overview`, `api.bill_list`, `api.bills_due`); UI hanya memformat.
 */

/** Satu kategori induk pengeluaran + anggaran periode itu (`api.budget_overview`). */
export interface BudgetOverviewVM {
  categoryId: string;
  name: string;
  icon: string;
  /** `null` = belum dianggarkan. */
  budget: Rupiah | null;
  wajib: boolean;
  /** Realisasi periode (wajib: tanpa bayar tagihan periode lain, review Task 7). */
  spent: Rupiah;
  /** floor(spent × 100 / budget); `null` bila belum dianggarkan. */
  pct: number | null;
  /** budget − spent, negatif bila lewat; `null` bila belum dianggarkan. */
  remaining: Rupiah | null;
  /** Kategori terarsip yang masih beranggaran di periode ini (UI hanya menawarkan Hapus). */
  archived: boolean;
}

/** Satu tagihan ruang ini (`api.bill_list`) + nama kategori/dompet ruang yang sama. */
export interface BillListVM {
  billId: string;
  name: string;
  /** Perkiraan nominal tagihan (K12). */
  amount: Rupiah;
  categoryId: string;
  categoryName: string;
  /** Induk kategori tagihan (= `categoryId` bila induk): salinan `obligation_double`. */
  rootCategoryId: string;
  accountId: string | null;
  accountName: string | null;
  dayOfMonth: number;
  startsOn: IsoDate;
  endsOn: IsoDate | null;
  archived: boolean;
  /** Kemunculan terbuka paling awal (termasuk lewat); `null` bila terarsip atau tidak ada. */
  nextDueOn: IsoDate | null;
  nextOccurrenceId: string | null;
}

/** Satu kemunculan tagihan (`api.bills_due`). */
export interface BillDueVM {
  occurrenceId: string;
  billId: string;
  name: string;
  /** Lunas = nominal entri bayar (K12), selain itu nominal kemunculan. */
  amount: Rupiah;
  dueOn: IsoDate;
  /** due_on − hari ini (WIB server): negatif = lewat. */
  daysUntil: number;
  overdue: boolean;
  posted: boolean;
  skipped: boolean;
  entryId: string | null;
}

/** Anggaran periode lalu (K13: tombol `Salin anggaran periode lalu`). */
export interface PreviousBudgetsVM {
  labelMonth: IsoDate;
  budgetCount: number;
  wajibCount: number;
  /** categoryId → nominal anggaran periode lalu. */
  amounts: Record<string, Rupiah>;
}

export interface RencanaData {
  /** Periode berjalan (anggaran berlabel `period.labelMonth`). */
  period: PeriodVM;
  previous: PreviousBudgetsVM;
  budgets: BudgetOverviewVM[];
  bills: BillListVM[];
  /** Kemunculan sampai akhir periode berjalan (termasuk lewat; lunas/dilewati di periode ini). */
  due: BillDueVM[];
  /** Dompet ruang ini (sheet Bayar/Tagihan): Bersama tanpa dompet Pribadi. */
  accounts: AccountVM[];
  /** Kategori aktif ruang ini. */
  categories: CategoryVM[];
}
