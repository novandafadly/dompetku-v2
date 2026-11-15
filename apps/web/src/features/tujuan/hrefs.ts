import type { Route } from 'next';
import type { Ruang } from '@/features/ledger/types';

/**
 * Alamat segmen Tujuan di Rencana (`?bagian=tujuan`, query yang dibawa tetap ada). Modul sendiri
 * (bukan `shell/hrefs`): `hrefs.ts` ikut JS muat awal semua rute, ini hanya dipakai mode nyata.
 */
export function buildGoalListHref(ruang: Ruang, query: string): Route {
  const params = new URLSearchParams(query);
  params.set('bagian', 'tujuan');
  return `/${ruang}/rencana?${params.toString()}` as Route;
}
