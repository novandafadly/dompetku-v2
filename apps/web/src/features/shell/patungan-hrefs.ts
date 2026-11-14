import type { Route } from 'next';

/**
 * Alamat Patungan (S12). Modul terpisah dari `hrefs.ts` (ikut JS muat awal semua rute): hanya mode
 * nyata Bersama yang memakainya. Pribadi tidak punya halaman ini (404).
 */

/** Halaman Patungan Bersama; `lunasi`/`terima` membuka sheetnya saat halaman termuat. */
export function buildPatunganHref(query: string, open?: 'lunasi' | 'terima'): Route {
  if (open === undefined) return `/bersama/patungan${query}` as Route;
  return `/bersama/patungan${query === '' ? '?' : `${query}&`}${open}=1` as Route;
}
