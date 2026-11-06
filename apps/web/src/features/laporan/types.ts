import type { IsoDate, Rupiah } from '@dompetku/domain';
import type { PeriodVM } from '@/features/ledger/types';

/**
 * View-model Laporan `/[ruang]/laporan` (S9 Task 13, bingkai S9-LP*). Dirangkai di server
 * (`server/ledger/laporan.ts`) dari fungsi baca 0121 + `period_summary`/`budget_progress`/
 * `member_contributions` atas ruang ini saja (B13). Semua angka uang dari SQL; UI hanya memformat.
 */

export type LaporanBasis = 'gajian' | 'kalender';

/** Periode yang dilihat + navigasi pemilih periode (‹ ›), tanggal dari `app.today()`. */
export interface LaporanPeriodVM extends Omit<PeriodVM, 'daysLeft'> {
  isCurrent: boolean;
  complete: boolean;
  /** Hanya periode berjalan (≥ 1); selain itu `null`. */
  daysLeft: number | null;
  /** `YYYY-MM` periode sebelumnya; `null` sebelum batas `2020-01`. */
  prev: string | null;
  /** `YYYY-MM` periode berikutnya; `null` di periode berjalan. */
  next: string | null;
}

export interface LaporanSummaryVM {
  pemasukan: Rupiah;
  pengeluaran: Rupiah;
  /** pemasukan − pengeluaran (SQL), bisa negatif. */
  selisih: Rupiah;
  /** Pengeluaran ini − periode sebelumnya (SQL); `null` bila tidak sah dibandingkan. */
  deltaPengeluaran: Rupiah | null;
  previous: { labelMonth: IsoDate; pengeluaran: Rupiah };
}

/** Satu baris `api.excluded_summary` (kelas `x_*` per arah, > 0). */
export interface ExcludedVM {
  reportClass: string;
  direction: 'in' | 'out';
  amount: Rupiah;
  entryCount: number;
}

/** Satu baris `api.category_summary`. */
export interface CategorySummaryVM {
  kind: 'category' | 'uncategorized' | 'fee';
  rootCategoryId: string | null;
  categoryId: string | null;
  type: 'income' | 'expense';
  amount: Rupiah;
  entryCount: number;
  typeTotal: Rupiah;
  pct10: number;
  rootTotal: Rupiah;
  rootPct10: number;
  pct10InRoot: number | null;
  name: string | null;
  icon: string | null;
  archived: boolean | null;
}

/** Satu baris `api.budget_progress` (hanya basis gajian). */
export interface BudgetProgressVM {
  categoryId: string;
  amount: Rupiah;
  wajib: boolean;
  spent: Rupiah;
  pct: number;
  remaining: Rupiah;
}

/** Satu baris `api.period_trend`. */
export interface TrendRowVM {
  labelMonth: IsoDate;
  from: IsoDate;
  to: IsoDate;
  pemasukan: Rupiah;
  pengeluaran: Rupiah;
  selisih: Rupiah;
  complete: boolean;
  isCurrent: boolean;
  daysLeft: number | null;
  deltaPengeluaran: Rupiah | null;
  holidaysKnown: boolean;
}
