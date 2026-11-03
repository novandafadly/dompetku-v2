// Bagian selectors demo; satu berkas per kelompok pemakai supaya rute hanya memuat yang dipakai
// (paket bebas efek samping, ADR 0002).
import type { Activity, DemoState } from '../types';
import { isLive } from './live';

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
