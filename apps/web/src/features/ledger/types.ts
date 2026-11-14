import type { IsoDate, Rupiah } from '@dompetku/domain';

/** View-model ledger: bentuk data yang dikonsumsi UI, sama untuk mode prototipe dan nyata. */
export type Ruang = 'pribadi' | 'bersama';
/**
 * `trading` (S12, hanya Pribadi) dan `patungan` (dompet sistem bagi tagihan Bersama, tidak pernah
 * tampil di daftar atau pemilih dompet: disaring `listAccountsTx`).
 */
export type Pocket = 'operasional' | 'tabungan' | 'kantor' | 'trading' | 'patungan';
/** Kantong yang boleh dipilih pengguna saat menambah dompet (`patungan` hanya dibuat DB). */
export type UserPocket = Exclude<Pocket, 'patungan'>;
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

/** Angka modal trading dari `api.trading_overview` (SQL; UI tidak menjumlah). */
export interface TradingFiguresVM {
  balance: Rupiah;
  capitalIn: Rupiah;
  capitalOut: Rupiah;
  /** `max(0, disetor − ditarik)`. */
  capitalLeft: Rupiah;
  /** `max(0, ditarik − disetor)`: penarikan di atas modal. */
  realized: Rupiah;
  /** `max(0, sisa modal − saldo)`: nominal peringatan `Kurang`. */
  shortfall: Rupiah;
  hasDeposit: boolean;
}

export interface TradingAccountVM extends TradingFiguresVM {
  id: string;
  name: string;
}

export interface TradingOverviewVM {
  accounts: TradingAccountVM[];
  total: TradingFiguresVM;
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
    | 'reimbursement'
    // S11: pokok utang dan cicilan (hanya Pribadi; arah uang di `direction`).
    | 'debt_principal'
    | 'debt_payment';
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
  /**
   * Hanya kaki `space_transfer`: ruang pemilik kaki ini. Kaki Bersama diberi judul dengan nama
   * pencatat, kaki Pribadi dengan arah (S7-D1); id kaki lawan tidak pernah dikirim.
   */
  spaceKind?: 'personal' | 'shared';
  /** Biaya transfer antar ruang; hanya kaki Pribadi (tidak pernah di kaki Bersama). */
  fee?: Rupiah;
  /** Entri asal yang sudah dipindah ke ruang lain (R16): waktu pindah; tanpa penunjuk ke tujuan. */
  movedAt?: string;
  /** Reimburse: id talangan yang diganti (ruang yang sama). */
  reimbursesEntryId?: string;
  /**
   * Pokok/cicilan utang (S11): utang yang ditunjuk. `deleted` = utangnya sudah dihapus (entri ikut
   * batal; pulihnya dari Utang, bukan dari entri). `voidedWithDebt` = entri ini dibatalkan oleh Hapus
   * utang (ikut pulih bersama utangnya); tanpa penanda berarti dibatalkan sendiri lebih dulu.
   */
  debt?: {
    id: string;
    direction: 'borrowed' | 'lent';
    contactName: string;
    title?: string;
    deleted?: true;
    voidedWithDebt?: true;
  };
}

/** Satu reimburse hidup pada sebuah talangan (daftar di Detail talangan, S7-D3). */
export interface ReimbursementItemVM {
  id: string;
  occurredOn: IsoDate;
  amount: Rupiah;
}

/** Status penggantian satu talangan hidup: Σ reimburse hidup dan sisanya. */
export interface TalanganVM {
  items: ReimbursementItemVM[];
  reimbursed: Rupiah;
  remaining: Rupiah;
}

/** Talangan hidup dengan sisa > 0 (`api.open_reimbursables`): nominal, Σ reimburse hidup, sisa. */
export interface ReimbursableVM {
  entryId: string;
  occurredOn: IsoDate;
  description: string | null;
  /** Nama kategori talangan (label bila tanpa keterangan); `null` bila tanpa kategori. */
  categoryName?: string | null;
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

/**
 * Periode (S9, K1): periode gajian BSD §8.2a dari `api.pay_period` (aturan gajian kosong = bulan
 * kalender, `basis = 'kalender'`). `label` = `November 2026 · 23 Okt – 24 Nov`; `labelMonth` =
 * tanggal 1 bulan label (`budgets.month`); `daysLeft` = `to − hari ini + 1` (≥ 1, SQL).
 */
export interface PeriodVM {
  label: string;
  from: IsoDate;
  to: IsoDate;
  labelMonth: IsoDate;
  daysLeft: number;
  holidaysKnown: boolean;
  basis: 'gajian' | 'kalender';
}

/** Keadaan kartu aman dipakai (K7): `lewat` = total < 0. */
export type AmanStatus = 'aman' | 'hati_hati' | 'lewat';

/**
 * Sebab `hati_hati` (S9-BR1): tagihan lewat jatuh tempo menang atas laju belanja. `null` untuk
 * `aman` dan `lewat` (salinan `lewat` dipilih UI dari `hasObligations`).
 */
export type AmanReason =
  { kind: 'overdue'; count: number } | { kind: 'pace'; avgDaily: Rupiah } | null;

/**
 * Aman dipakai lengkap mode nyata (S9): semua angka dari `api.safe_to_spend` (sampai `until` =
 * akhir periode gajian) dan `api.spend_pace`; `status`/`reason` dari fungsi murni `amanStatus`.
 * Prototipe tetap memakai `SafeToSpendVM` (tipe saja, nol byte).
 */
export interface SafeToSpendFullVM extends SafeToSpendVM {
  until: IsoDate;
  daysLeft: number;
  /** `floor(aman / daysLeft)` (SQL). */
  perDay: Rupiah;
  status: AmanStatus;
  reason: AmanReason;
  /** Ruang punya tagihan aktif atau anggaran wajib berlabel periode ini (baris rincian kartu). */
  hasObligations: boolean;
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
  // S9: anggaran dan tagihan (bingkai S9 "Salinan galat S9").
  | 'obligation_double'
  | 'category_in_obligation'
  | 'category_not_root'
  // S10: anggaran rincian (bingkai S10 "Salinan galat S10").
  | 'parent_budget_required'
  | 'sub_exceeds_parent'
  | 'sub_not_wajib'
  // S10: ekspor (0127).
  | 'export_too_large'
  | 'already_posted'
  | 'bill_archived'
  | 'bill_account_kantor'
  // S11: utang/piutang dan kontak (0130–0131; bingkai S11 "Salinan galat S11").
  | 'debt_personal_only'
  | 'contact_name_taken'
  | 'contact_archived'
  | 'debt_deleted'
  | 'payment_exceeds'
  | 'payment_before_opened'
  | 'debt_account_kantor'
  | 'debt_principal_locked'
  // S12: dompet Trading hanya di Pribadi (0134, B10).
  | 'pocket_personal_only'
  | 'not_found'
  | 'invalid'
  | 'network'
  | 'unknown';

export type ActionResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: LedgerErrorCode; field?: string } };
