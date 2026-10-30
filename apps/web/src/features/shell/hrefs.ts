import type { Route } from 'next';
import type { Ruang } from '@dompetku/demo-data';

export const TABS = ['beranda', 'transaksi', 'dompet', 'rencana'] as const;
export type Tab = (typeof TABS)[number];

export const RUANG_LABEL: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

export function isRuang(value: string | undefined): value is Ruang {
  return value === 'pribadi' || value === 'bersama';
}

/** Query demo yang dipertahankan antar halaman agar tautan dan tes stabil. */
export const KEPT_PARAMS = ['seed', 'today', 'hero'] as const;

export function keptQuery(params: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const key of KEPT_PARAMS) {
    const v = params.get(key);
    if (v !== null) kept.set(key, v);
  }
  const s = kept.toString();
  return s === '' ? '' : '?' + s;
}

export function buildHref(ruang: Ruang, tab: Tab, query: string): Route {
  return `/${ruang}/${tab}${query}` as Route;
}

export function tabFromPathname(pathname: string): Tab {
  const seg = pathname.split('/')[2];
  return TABS.find((t) => t === seg) ?? 'beranda';
}
