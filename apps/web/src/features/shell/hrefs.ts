import type { Route } from 'next';
import type { Ruang } from '@dompetku/demo-data';
import { monthName } from '@dompetku/domain';

export const TABS = ['beranda', 'transaksi', 'dompet', 'rencana'] as const;
export type Tab = (typeof TABS)[number];

export const RUANG_LABEL: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

export function isRuang(value: string | undefined): value is Ruang {
  return value === 'pribadi' || value === 'bersama';
}

/** Query demo yang dipertahankan antar halaman agar tautan dan tes stabil. */
export const KEPT_PARAMS = ['seed', 'today', 'theme', 'keypad', 'state'] as const;

/** Mode nyata: hanya tema yang terbawa (`bulan` ditangani terpisah di dalam Transaksi). */
export const REAL_KEPT_PARAMS = ['theme'] as const;

export function keptQuery(params: URLSearchParams, keys: readonly string[] = KEPT_PARAMS): string {
  const kept = new URLSearchParams();
  for (const key of keys) {
    const v = params.get(key);
    if (v !== null) kept.set(key, v);
  }
  const s = kept.toString();
  return s === '' ? '' : '?' + s;
}

/** Query tersimpan tanpa satu parameter (mis. `state` setelah Coba lagi). */
export function withoutParam(query: string, key: string): string {
  const params = new URLSearchParams(query);
  params.delete(key);
  const s = params.toString();
  return s === '' ? '' : '?' + s;
}

/** Bulan terpilih di Transaksi ('YYYY-MM'); tidak valid atau setelah bulan ini → bulan ini. */
export function validMonth(raw: string | null, today: string): string {
  const current = today.slice(0, 7);
  if (raw === null) return current;
  try {
    monthName(raw);
  } catch (e) {
    if (e instanceof RangeError) return current;
    throw e;
  }
  return raw > current ? current : raw;
}

/** `?bulan=` hanya ditulis bila bukan bulan ini. */
function withMonth(query: string, month: string | undefined, today: string): string {
  if (month === undefined || month === today.slice(0, 7)) return query;
  return `${query}${query === '' ? '?' : '&'}bulan=${month}`;
}

export function buildHref(
  ruang: Ruang,
  tab: Tab,
  query: string,
  month?: { value: string; today: string },
): Route {
  const q = tab === 'transaksi' && month ? withMonth(query, month.value, month.today) : query;
  return `/${ruang}/${tab}${q}` as Route;
}

export function buildEntryHref(
  ruang: Ruang,
  id: string,
  query: string,
  month?: { value: string; today: string },
): Route {
  const q = month ? withMonth(query, month.value, month.today) : query;
  return `/${ruang}/transaksi/${encodeURIComponent(id)}${q}` as Route;
}

export function buildAccountHref(ruang: Ruang, id: string, query: string): Route {
  return `/${ruang}/dompet/${encodeURIComponent(id)}${query}` as Route;
}

/** Layar ruang di luar tab: `/{ruang}/sampah`, `/{ruang}/kategori` (rutenya menyusul). */
export function buildSectionHref(
  ruang: Ruang,
  section: 'sampah' | 'kategori',
  query: string,
): Route {
  return `/${ruang}/${section}${query}` as Route;
}

export const AUTH_PAGES = ['masuk', 'amankan', 'undang', 'terima-undangan', 'buat-akun'] as const;
export type AuthPage = (typeof AUTH_PAGES)[number];

export function buildAuthHref(page: AuthPage, query: string): Route {
  return `/${page}${query}` as Route;
}

export function tabFromPathname(pathname: string): Tab {
  const seg = pathname.split('/')[2];
  return TABS.find((t) => t === seg) ?? 'beranda';
}
