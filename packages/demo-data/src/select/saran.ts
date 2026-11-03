// Bagian selectors demo; satu berkas per kelompok pemakai supaya rute hanya memuat yang dipakai
// (paket bebas efek samping, ADR 0002).
import { addDays } from '@dompetku/domain';
import type { Rupiah } from '@dompetku/domain';
import type { Category, DemoState, Ruang } from '../types';
import { isLive } from './live';

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
