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
  /** S10: induknya bila ini rincian (subkategori); `null` = induk. */
  parentId: string | null;
  /** Induk: jumlah anggaran rinciannya di periode ini (SQL); `null` untuk rincian. */
  subAllocated: Rupiah | null;
  /** Rincian: batas atas yang masih boleh diisi (anggaran induk − rincian saudara, SQL); `null` untuk induk. */
  maxAmount: Rupiah | null;
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

/**
 * Total kartu Anggaran (`budgetTotalsTx`, dijumlah di SQL): hanya kategori beranggaran;
 * `pct` = floor(spent × 100 / budget), 0 bila tanpa anggaran.
 */
export interface BudgetTotalsVM {
  budget: Rupiah;
  spent: Rupiah;
  remaining: Rupiah;
  pct: number;
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
  /** Tanggal entri bayar (`occurred_on`); `null` bila belum dibayar. */
  paidOn: IsoDate | null;
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
  /** Kategori induk (S9). */
  budgets: BudgetOverviewVM[];
  /** Rincian (S10): beranggaran, atau aktif dari induk beranggaran (kandidat Tambah rincian). */
  subBudgets: BudgetOverviewVM[];
  /** Total kartu Anggaran, dari SQL. */
  totals: BudgetTotalsVM;
  bills: BillListVM[];
  /** Kemunculan sampai akhir periode berjalan (termasuk lewat; lunas/dilewati di periode ini). */
  due: BillDueVM[];
  /** Kemunculan sesudah akhir periode berjalan yang sudah dimaterialisasi (kelompok Berikutnya). */
  upcoming: BillDueVM[];
  /** Hari ini WIB dari server (`app.today()`): bawaan tanggal Mulai/Bayar, bukan jam Node. */
  today: IsoDate;
  /** Dompet ruang ini (sheet Bayar/Tagihan): Bersama tanpa dompet Pribadi. */
  accounts: AccountVM[];
  /** Kategori aktif ruang ini. */
  categories: CategoryVM[];
}
