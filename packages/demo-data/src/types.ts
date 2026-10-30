import type { IsoDate, Rupiah } from '@dompetku/domain';

export type Ruang = 'pribadi' | 'bersama';
export type Pocket = 'operasional' | 'tabungan' | 'kantor';

export interface Member {
  id: string;
  name: 'Novanda' | 'Farida';
  initial: string;
}

export interface Account {
  id: string;
  ruang: Ruang;
  ownerId: string | null;
  name: string;
  pocket: Pocket;
  walletType: 'cash' | 'bank' | 'ewallet';
  openedOn: IsoDate;
}

export interface Category {
  id: string;
  ruang: Ruang;
  parentId: string | null;
  name: string;
  type: 'income' | 'expense';
  /** Nama ikon Phosphor. */
  icon: string;
}

export interface Entry {
  id: string;
  ruang: Ruang;
  kind: 'income' | 'expense' | 'transfer' | 'opening_balance' | 'space_transfer';
  occurredOn: IsoDate;
  /** ISO 8601 dengan offset +07:00. */
  createdAt: string;
  createdBy: string;
  accountId: string;
  counterAccountId?: string;
  /** Selalu positif. */
  amount: Rupiah;
  categoryId?: string;
  description?: string;
  reimbursable?: boolean;
  voidedAt?: string;
  /** space_transfer: kedua kaki berbagi linkId. */
  linkId?: string;
  /** space_transfer: 'out' di ruang asal, 'in' di ruang tujuan. */
  direction?: 'out' | 'in';
  /** Catatan yang sengaja dibagikan ke ruang tujuan (kaki 'in'). */
  sharedNote?: string;
}

export interface Bill {
  id: string;
  ruang: Ruang;
  name: string;
  amount: Rupiah;
  dueOn: IsoDate;
  posted: boolean;
}

export interface Budget {
  ruang: Ruang;
  categoryId: string;
  /** Hari pertama bulan, 'YYYY-MM-01'. */
  month: IsoDate;
  amount: Rupiah;
  wajib: boolean;
}

export interface Activity {
  id: string;
  at: string;
  actor: Member;
  text: string;
  amount?: Rupiah;
  before?: Rupiah;
}

export interface DemoState {
  today: IsoDate;
  members: Member[];
  accounts: Account[];
  categories: Category[];
  entries: Entry[];
  bills: Bill[];
  budgets: Budget[];
}
