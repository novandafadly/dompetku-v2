import type { Route } from 'next';

/**
 * Alamat Patungan (S12). Modul terpisah dari `hrefs.ts` (ikut JS muat awal semua rute): hanya mode
 * nyata Bersama yang memakainya. Pribadi tidak punya halaman ini (404).
 */

/**
 * Halaman Patungan Bersama. `open` membuka sheet saat halaman termuat: kartu Beranda memakai
 * tautan (bukan pulau klien) supaya JS Beranda tidak bertambah; `?lunasi=1` = Lunasi,
 * `?terima={id pelunasan}` = Terima pelunasan itu.
 */
export function buildPatunganHref(query: string, open?: 'lunasi' | { terima: string }): Route {
  if (open === undefined) return `/bersama/patungan${query}` as Route;
  const part = open === 'lunasi' ? 'lunasi=1' : `terima=${encodeURIComponent(open.terima)}`;
  return `/bersama/patungan${query === '' ? '?' : `${query}&`}${part}` as Route;
}
