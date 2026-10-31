/**
 * Path skrip yang dirujuk HTML sebuah rute: `<script src>` dan `<link … .js>`.
 * Skrip `nomodule` (polyfill untuk browser lama) dilewati karena browser modern tidak memuatnya.
 * Prefetch rute lain dan chunk muat malas tidak ada di HTML, jadi tidak termasuk.
 */
export function routeScripts(html: string): Set<string> {
  const paths = new Set<string>();
  const add = (url: string | undefined) => {
    if (url) paths.add(new URL(url, 'http://localhost').pathname);
  };
  for (const m of html.matchAll(/<script\b[^>]*>/g)) {
    if (/\snomodule\b/i.test(m[0])) continue;
    add(/\ssrc="([^"]+)"/.exec(m[0])?.[1]);
  }
  for (const m of html.matchAll(/<link\b[^>]*>/g)) {
    add(/\shref="([^"]+\.js)"/.exec(m[0])?.[1]);
  }
  return paths;
}
