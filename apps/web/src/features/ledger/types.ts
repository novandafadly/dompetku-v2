import type { IsoDate, Rupiah } from '@dompetku/domain';

/** View-model ledger: bentuk data yang dikonsumsi UI, sama untuk mode prototipe dan nyata. */
export type Ruang = 'pribadi' | 'bersama';
export type Pocket = 'operasional' | 'tabungan' | 'kantor';
export type WalletType = 'cash' | 'bank' | 'ewallet';

export interface AccountVM {
  id: string;
  name: string;
  pocket: Pocket;
  walletType: WalletType;
  openedOn: IsoDate;
  archived: boolean;
  balance: Rupiah;
}

export interface CategoryVM {
  id: string;
  parentId: string | null;
  name: string;
  type: 'income' | 'expense';
  icon: string;
  archived: boolean;
}

export interface EntryVM {
  id: string;
  version: number;
  kind:
    | 'income'
    | 'expense'
    | 'transfer'
    | 'opening_balance'
    | 'space_transfer'
    | 'adjustment'
    | 'reimbursement';
  occurredOn: IsoDate;
  createdAt: string;
  createdBy: { id: string; name: string; initial: string };
  accountId: string;
  accountName: string;
  counterAccountId?: string;
  counterAccountName?: string;
  amount: Rupiah;
  categoryId?: string;
  categoryName?: string;
  categoryIcon?: string;
  description?: string;
  voidedAt?: string;
  direction?: 'out' | 'in';
  sharedNote?: string;
  /** Hanya pengeluaran Pribadi yang ditalangi (S7); `true` bila ya, tidak ada bila tidak. */
  reimbursable?: true;
}

/** Talangan hidup dengan sisa > 0 (`api.open_reimbursables`): nominal, Σ reimburse hidup, sisa. */
export interface ReimbursableVM {
  entryId: string;
  occurredOn: IsoDate;
  description: string | null;
  accountId: string;
  amount: Rupiah;
  reimbursed: Rupiah;
  remaining: Rupiah;
}

export interface HistoryVM {
  version: number;
  op: 'create' | 'update' | 'void' | 'restore';
  at: string;
  by: { name: string; initial: string };
  /** Id user yang mengubah (layar konflik: "Kamu" bila pengguna sendiri, mis. tab lain). */
  changedBy: string;
  amount?: Rupiah;
}

export interface TrashVM {
  entry: EntryVM;
  purgeAfter: string;
}

export interface MonthSummaryVM {
  pemasukan: Rupiah;
  pengeluaran: Rupiah;
  selisih: Rupiah;
  transfer: Rupiah;
}

export interface SafeToSpendVM {
  operasional: Rupiah;
  billsUntilEom: Rupiah;
  budgetWajibRemaining: Rupiah;
  aman: Rupiah;
}

export interface TodayStatusVM {
  /** Ada pengeluaran hidup hari ini (WIB server) di ruang ini; jenis lain tidak dihitung. */
  hasExpense: boolean;
  noSpendMarked: boolean;
}

export type LedgerErrorCode =
  | 'conflict'
  | 'idem_mismatch'
  | 'saldo_negatif'
  | 'before_opening'
  | 'account_archived'
  | 'category_archived'
  | 'category_depth'
  | 'name_taken'
  | 'restore_window_closed'
  | 'balance_not_zero'
  | 'cross_space_not_allowed'
  | 'cross_space_kantor'
  | 'not_reimbursable'
  | 'reimbursement_exceeds'
  | 'reimbursement_exists'
  | 'entry_moved'
  | 'kind_not_movable'
  | 'not_creator'
  | 'not_found'
  | 'invalid'
  | 'network'
  | 'unknown';

export type ActionResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: LedgerErrorCode; field?: string } };
