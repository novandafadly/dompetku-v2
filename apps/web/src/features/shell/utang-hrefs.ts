import type { Route } from 'next';
import type { Ruang } from '@dompetku/demo-data';

/**
 * Alamat Utang dan Kontak (S11). Modul terpisah dari `hrefs.ts`: `hrefs.ts` ikut JS muat awal
 * semua rute (termasuk Beranda prototipe, +0 byte), alamat ini hanya dipakai mode nyata.
 */

/** Segmen Utang di Rencana: `?bagian=utang`, query yang dibawa tetap ada. */
export function buildDebtListHref(ruang: Ruang, query: string): Route {
  const params = new URLSearchParams(query);
  params.set('bagian', 'utang');
  return `/${ruang}/rencana?${params.toString()}` as Route;
}

/** Detail utang: `/{ruang}/rencana/utang/{id}`. */
export function buildDebtHref(ruang: Ruang, id: string, query: string): Route {
  return `/${ruang}/rencana/utang/${encodeURIComponent(id)}${query}` as Route;
}

/** Halaman Kontak: hanya Pribadi; di Bersama rutenya 404. */
export function buildKontakHref(ruang: Ruang, query: string): Route {
  return `/${ruang}/kontak${query}` as Route;
}
