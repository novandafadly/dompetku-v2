// Bagian selectors demo; satu berkas per kelompok pemakai supaya rute hanya memuat yang dipakai
// (paket bebas efek samping, ADR 0002).
import { dayLabel } from '@dompetku/domain';
import type { IsoDate, Rupiah } from '@dompetku/domain';
import type { Entry } from '../types';
import { isLive } from './live';

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
