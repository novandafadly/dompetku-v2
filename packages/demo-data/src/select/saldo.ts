// Bagian selectors demo; satu berkas per kelompok pemakai supaya rute hanya memuat yang dipakai
// (paket bebas efek samping, ADR 0002).
import { daysInclusive, endOfMonth } from '@dompetku/domain';
import type { IsoDate, Rupiah } from '@dompetku/domain';
import type { Budget, Category, DemoState, Ruang } from '../types';
import { isLive } from './live';

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
