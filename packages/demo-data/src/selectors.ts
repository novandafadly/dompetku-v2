import { addDays, dayLabel, daysInclusive, endOfMonth } from '@dompetku/domain';
import type { IsoDate, Rupiah } from '@dompetku/domain';
import type { Activity, Budget, Category, DemoState, Entry, Ruang } from './types';

function isLive(e: Entry): boolean {
  return e.voidedAt === undefined;
}

export function balances(state: DemoState, ruang: Ruang): Map<string, Rupiah> {
  const map = new Map<string, Rupiah>();
  for (const a of state.accounts) if (a.ruang === ruang) map.set(a.id, 0);
  const add = (id: string, delta: Rupiah) => {
    const cur = map.get(id);
    if (cur !== undefined) map.set(id, cur + delta);
  };
  for (const e of state.entries) {
    if (!isLive(e)) continue;
    switch (e.kind) {
      case 'income':
      case 'opening_balance':
        add(e.accountId, e.amount);
        break;
      case 'expense':
        add(e.accountId, -e.amount);
        break;
      case 'transfer':
        add(e.accountId, -e.amount);
        if (e.counterAccountId !== undefined) add(e.counterAccountId, e.amount);
        break;
      case 'space_transfer':
        add(e.accountId, e.direction === 'in' ? e.amount : -e.amount);
        break;
    }
  }
  return map;
}

function monthSpentByRoot(state: DemoState, ruang: Ruang, monthKey: string): Map<string, Rupiah> {
  const parentOf = new Map<string, string | null>();
  for (const c of state.categories) parentOf.set(c.id, c.parentId);
  const spent = new Map<string, Rupiah>();
  for (const e of state.entries) {
    if (!isLive(e) || e.ruang !== ruang || e.kind !== 'expense') continue;
    if (e.categoryId === undefined || !e.occurredOn.startsWith(monthKey)) continue;
    const root = parentOf.get(e.categoryId) ?? e.categoryId;
    spent.set(root, (spent.get(root) ?? 0) + e.amount);
  }
  return spent;
}

export interface BudgetProgress {
  budget: Budget;
  category: Category;
  spent: Rupiah;
  /** Persen bulat, dibulatkan ke bawah. */
  pct: number;
}

export function budgetProgress(state: DemoState, ruang: Ruang, today: IsoDate): BudgetProgress[] {
  const monthKey = today.slice(0, 7);
  const spent = monthSpentByRoot(state, ruang, monthKey);
  const rows: BudgetProgress[] = [];
  for (const budget of state.budgets) {
    if (budget.ruang !== ruang || budget.month !== monthKey + '-01') continue;
    const category = state.categories.find((c) => c.id === budget.categoryId);
    if (!category) continue;
    const s = spent.get(budget.categoryId) ?? 0;
    rows.push({ budget, category, spent: s, pct: Math.floor((s * 100) / budget.amount) });
  }
  return rows;
}

export interface SafeToSpend {
  operasional: Rupiah;
  billsUntilEom: Rupiah;
  budgetWajibRemaining: Rupiah;
  total: Rupiah;
  perDay: Rupiah;
  daysLeft: number;
  until: IsoDate;
}

export function safeToSpend(state: DemoState, ruang: Ruang, today: IsoDate): SafeToSpend {
  const until = endOfMonth(today);
  const monthKey = until.slice(0, 7);
  const monthStart = monthKey + '-01';

  const bal = balances(state, ruang);
  let operasional = 0;
  for (const a of state.accounts) {
    if (a.ruang === ruang && a.pocket === 'operasional') operasional += bal.get(a.id) ?? 0;
  }

  let billsUntilEom = 0;
  for (const b of state.bills) {
    if (b.ruang === ruang && !b.posted && b.dueOn <= until) billsUntilEom += b.amount;
  }

  const spent = monthSpentByRoot(state, ruang, monthKey);
  let budgetWajibRemaining = 0;
  for (const b of state.budgets) {
    if (b.ruang !== ruang || !b.wajib || b.month !== monthStart) continue;
    budgetWajibRemaining += Math.max(0, b.amount - (spent.get(b.categoryId) ?? 0));
  }

  const total = operasional - billsUntilEom - budgetWajibRemaining;
  const daysLeft = daysInclusive(today, until);
  const perDay = daysLeft > 0 ? Math.floor(total / daysLeft) : total;
  return { operasional, billsUntilEom, budgetWajibRemaining, total, perDay, daysLeft, until };
}

export interface DayGroup {
  date: IsoDate;
  label: string;
  net: Rupiah;
  items: Entry[];
}

function newestFirst(a: Entry, b: Entry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function groupByDay(entries: Entry[], today: IsoDate): DayGroup[] {
  const byDate = new Map<IsoDate, Entry[]>();
  for (const e of entries) {
    if (!isLive(e)) continue;
    const list = byDate.get(e.occurredOn);
    if (list) list.push(e);
    else byDate.set(e.occurredOn, [e]);
  }
  return [...byDate.keys()]
    .sort()
    .reverse()
    .map((date) => {
      const items = (byDate.get(date) ?? []).sort(newestFirst);
      let net = 0;
      for (const e of items) {
        if (e.kind === 'income') net += e.amount;
        else if (e.kind === 'expense') net -= e.amount;
      }
      return { date, label: dayLabel(date, today), net, items };
    });
}

const HOUR_WINDOW = 2;
const SUGGESTION_COUNT = 6;
const WINDOW_DAYS = 30;

function hourOf(createdAt: string): number {
  return Number(createdAt.slice(11, 13));
}

function hourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

function compareNames(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

export function suggestCategories(
  state: DemoState,
  ruang: Ruang,
  opts: { amount?: Rupiah; hourWIB: number; type?: Category['type'] },
): Category[] {
  const type = opts.type ?? 'expense';
  const today = state.today;
  const since = addDays(today, -WINDOW_DAYS);
  const score = new Map<string, number>();
  for (const e of state.entries) {
    if (!isLive(e) || e.ruang !== ruang || e.kind !== type || e.categoryId === undefined) {
      continue;
    }
    if (e.occurredOn <= since || e.occurredOn > today) continue;
    const hourWeight = hourDistance(hourOf(e.createdAt), opts.hourWIB) <= HOUR_WINDOW ? 3 : 1;
    const amountWeight =
      opts.amount !== undefined && e.amount >= opts.amount / 2 && e.amount <= opts.amount * 2
        ? 1.5
        : 1;
    score.set(e.categoryId, (score.get(e.categoryId) ?? 0) + hourWeight * amountWeight);
  }
  return state.categories
    .filter((c) => c.ruang === ruang && c.type === type)
    .sort((a, b) => {
      const diff = (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0);
      return diff !== 0 ? diff : compareNames(a.name, b.name);
    })
    .slice(0, SUGGESTION_COUNT);
}

export function activityFeed(state: DemoState, limit: number): Activity[] {
  const members = new Map(state.members.map((m) => [m.id, m]));
  const cats = new Map(state.categories.map((c) => [c.id, c.name]));
  const feed: Activity[] = [];
  for (const e of state.entries) {
    if (e.ruang !== 'bersama' || !isLive(e) || e.kind === 'opening_balance') continue;
    const actor = members.get(e.createdBy);
    if (!actor) continue;
    let text: string;
    if (e.kind === 'space_transfer') {
      if (e.direction !== 'in') continue;
      text = e.sharedNote ?? 'Setoran dari Pribadi';
    } else if (e.kind === 'transfer') {
      text = e.description ?? 'Pindah dompet';
    } else {
      const name =
        e.description ?? (e.categoryId !== undefined ? cats.get(e.categoryId) : undefined);
      text = (e.kind === 'income' ? 'Pemasukan: ' : 'Pengeluaran: ') + (name ?? 'Tanpa kategori');
    }
    feed.push({ id: 'act-' + e.id, at: e.createdAt, actor, text, amount: e.amount });
  }
  return feed
    .sort((a, b) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.id < b.id ? 1 : -1))
    .slice(0, limit);
}

/** Nada nominal: pemasukan, pengeluaran, atau netral (transfer dan saldo awal). */
export type AmountKind = 'income' | 'expense' | 'neutral';

/** Judul entri di daftar: deskripsi, lalu catatan bersama, lalu nama kategori. */
export function entryTitle(state: DemoState, e: Entry): string {
  switch (e.kind) {
    case 'opening_balance':
      return 'Saldo awal';
    case 'transfer':
      return e.description ?? 'Pindah dompet';
    case 'space_transfer':
      return (
        e.sharedNote ??
        e.description ??
        (e.direction === 'in' ? 'Setoran dari Pribadi' : 'Setoran ke Bersama')
      );
    default:
      return (
        e.description ??
        state.categories.find((c) => c.id === e.categoryId)?.name ??
        'Tanpa kategori'
      );
  }
}

/** Nominal bertanda dari sudut pandang ruang entri: pengeluaran dan setoran keluar negatif. */
export function signedAmount(e: Entry): { value: number; kind: AmountKind } {
  switch (e.kind) {
    case 'income':
      return { value: e.amount, kind: 'income' };
    case 'expense':
      return { value: -e.amount, kind: 'expense' };
    case 'space_transfer':
      return { value: e.direction === 'in' ? e.amount : -e.amount, kind: 'neutral' };
    default:
      return { value: e.amount, kind: 'neutral' };
  }
}

export interface MonthSummary {
  pemasukan: Rupiah;
  pengeluaran: Rupiah;
  /** pemasukan − pengeluaran; bisa negatif. */
  selisih: Rupiah;
  /** Σ pemasukan + pengeluaran di dompet pocket kantor (tidak masuk tiga angka di atas). */
  kantor: Rupiah;
  /** Σ transfer + Σ kaki space_transfer ruang ini (keluar di asal, masuk di tujuan). */
  transfer: Rupiah;
}

/** Ringkasan bulan 'YYYY-MM'. Saldo awal dan entri batal tidak dihitung. */
export function monthSummary(state: DemoState, ruang: Ruang, month: string): MonthSummary {
  const kantorIds = new Set(
    state.accounts.filter((a) => a.ruang === ruang && a.pocket === 'kantor').map((a) => a.id),
  );
  let pemasukan = 0;
  let pengeluaran = 0;
  let kantor = 0;
  let transfer = 0;
  for (const e of state.entries) {
    if (!isLive(e) || e.ruang !== ruang || !e.occurredOn.startsWith(month)) continue;
    if (e.kind === 'income' || e.kind === 'expense') {
      if (kantorIds.has(e.accountId)) kantor += e.amount;
      else if (e.kind === 'income') pemasukan += e.amount;
      else pengeluaran += e.amount;
    } else if (e.kind === 'transfer' || e.kind === 'space_transfer') {
      transfer += e.amount;
    }
  }
  return { pemasukan, pengeluaran, selisih: pemasukan - pengeluaran, kantor, transfer };
}
