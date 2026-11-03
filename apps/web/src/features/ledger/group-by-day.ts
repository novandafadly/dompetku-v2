import { dayLabel, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { EntryVM } from './types';

/** Satu hari di daftar Transaksi: label relatif, total bersih hari itu, entri terbaru di atas. */
export interface DayGroupVM {
  date: IsoDate;
  label: string;
  /** Σ pemasukan − Σ pengeluaran hari itu; jenis lain tidak dihitung. */
  total: Rupiah;
  entries: EntryVM[];
}

function newestFirst(a: EntryVM, b: EntryVM): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Pengelompokan per hari untuk VM, logikanya sama dengan `groupByDay` demo (unit tes oracle):
 * hanya entri hidup, tanggal terbaru dulu, dalam hari `createdAt` lalu `id` menurun. Tidak
 * bergantung pada urutan masukan. Dipakai di server (mode nyata), bukan di bundel klien.
 */
export function groupByDayVM(entries: readonly EntryVM[], today: IsoDate): DayGroupVM[] {
  const byDate = new Map<IsoDate, EntryVM[]>();
  for (const e of entries) {
    if (e.voidedAt !== undefined) continue;
    const list = byDate.get(e.occurredOn);
    if (list) list.push(e);
    else byDate.set(e.occurredOn, [e]);
  }
  return [...byDate.keys()]
    .sort()
    .reverse()
    .map((date) => {
      const items = (byDate.get(date) ?? []).sort(newestFirst);
      let total = 0;
      for (const e of items) {
        if (e.kind === 'income') total += e.amount;
        else if (e.kind === 'expense') total -= e.amount;
      }
      return { date, label: dayLabel(date, today), total, entries: items };
    });
}
