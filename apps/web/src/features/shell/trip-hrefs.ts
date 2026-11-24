import type { Route } from 'next';
import type { Ruang } from '@dompetku/demo-data';

/**
 * Alamat Trip (S15-TR1): modul terpisah dari `hrefs.ts` agar `hrefs.ts` (JS muat awal semua rute
 * termasuk Beranda prototipe) tidak bertambah byte.
 */

/** Daftar Trip: `/{ruang}/trip` (Pribadi dan Bersama mode nyata; 404 di prototipe). */
export function buildTripListHref(ruang: Ruang, query: string): Route {
  return `/${ruang}/trip${query}` as Route;
}

/** Detail satu trip: `/{ruang}/trip/{id}`. */
export function buildTripHref(ruang: Ruang, id: string, query: string): Route {
  return `/${ruang}/trip/${encodeURIComponent(id)}${query}` as Route;
}
