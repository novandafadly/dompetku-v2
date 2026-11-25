import type { Route } from 'next';
import type { Ruang } from '@/features/ledger/types';

/**
 * Pembangun tautan halaman Analisis AI (`/[ruang]/analisis`, S18).
 * Modul terpisah dari `hrefs.ts` agar tidak menambah 1 byte pun ke bundle awal rute prototipe.
 */
export function buildAnalisisHref(ruang: Ruang, query: string): Route {
  return `/${ruang}/analisis${query}` as Route;
}
