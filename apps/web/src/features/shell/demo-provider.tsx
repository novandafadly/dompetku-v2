'use client';

import { addDays, isoAtWIB, nowIsoWIB, todayWIB } from '@dompetku/domain';
import type { IsoDate } from '@dompetku/domain';
import { createDemoStore, createSeed } from '@dompetku/demo-data';
import type { DemoState, DemoStore, Ruang } from '@dompetku/demo-data';
import type { Route } from 'next';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  Suspense,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  buildAccountHref,
  buildAuthHref,
  buildEntryHref,
  buildHref,
  isRuang,
  keptQuery,
  tabFromPathname,
  validMonth,
  type AuthPage,
  type Tab,
} from './hrefs';

interface DemoValue {
  store: DemoStore;
  ruang: Ruang;
  today: IsoDate;
  /** Tema tampilan: gelap bawaan, terang lewat `?theme=light` (sampai Pengaturan ada). */
  theme: 'dark' | 'light';
  /** Varian keypad Catat: A keyboard OS, B keypad dalam aplikasi (`?keypad=app`). */
  keypad: 'os' | 'app';
  query: string;
  /** Nilai mentah `?bulan=` di alamat saat ini. */
  bulan: string | null;
}

const DemoContext = createContext<DemoValue | null>(null);

function validToday(raw: string | null): IsoDate {
  if (raw === null) return todayWIB();
  try {
    addDays(raw, 0);
    return raw;
  } catch (e) {
    if (e instanceof RangeError) return todayWIB();
    throw e;
  }
}

/**
 * Jam toko demo: tanggal mengikuti `today`, jam mengikuti WIB sekarang. Entri baru tidak
 * boleh terurut di bawah entri yang sudah ada di hari yang sama (jam seed bisa lebih
 * larut dari jam sekarang), jadi hasilnya minimal satu detik setelah createdAt terbaru.
 */
function demoClock(today: IsoDate, store: () => DemoStore): () => string {
  return () => {
    const candidate = isoAtWIB(today);
    let latest = '';
    for (const e of store().getState().entries) if (e.createdAt > latest) latest = e.createdAt;
    if (candidate > latest) return candidate;
    return nowIsoWIB(new Date(Date.parse(latest) + 1000));
  };
}

function DemoProviderInner({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();
  // Query dibaca sekali saat mount; navigasi berikutnya tidak membuat ulang store.
  const [boot] = useState(() => {
    const today = validToday(params.get('today'));
    const variant = params.get('seed') === 'empty' ? 'empty' : 'full';
    const theme = params.get('theme') === 'light' ? 'light' : 'dark';
    const keypad = params.get('keypad') === 'app' ? 'app' : 'os';
    const store: DemoStore = createDemoStore(createSeed({ today, variant }), {
      clock: demoClock(today, () => store),
    });
    return { today, theme, keypad, query: keptQuery(params), store } as const;
  });

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = boot.theme;
  }, [boot.theme]);

  const segment = pathname.split('/')[1];
  const ruang: Ruang = isRuang(segment) ? segment : 'pribadi';

  return (
    <DemoContext.Provider value={{ ...boot, ruang, bulan: params.get('bulan') }}>
      {children}
    </DemoContext.Provider>
  );
}

export function DemoProvider({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <DemoProviderInner>{children}</DemoProviderInner>
    </Suspense>
  );
}

export function useDemo(): {
  state: DemoState;
  store: DemoStore;
  ruang: Ruang;
  today: IsoDate;
  keypad: 'os' | 'app';
  /** Alamat tab di ruang tertentu dengan query demo yang dipertahankan. */
  href: (ruang: Ruang, tab: Tab) => Route;
  /** Alamat detail transaksi dengan query demo yang dipertahankan. */
  entryHref: (ruang: Ruang, id: string) => Route;
  /** Alamat riwayat dompet dengan query demo yang dipertahankan. */
  accountHref: (ruang: Ruang, id: string) => Route;
  /** Alamat layar auth tiruan dengan query demo yang dipertahankan. */
  authHref: (page: AuthPage) => Route;
  /** Bulan terpilih di Transaksi ('YYYY-MM'), dari `?bulan=`. */
  month: string;
  /** Alamat daftar Transaksi untuk bulan tertentu. */
  monthHref: (ruang: Ruang, month: string) => Route;
} {
  const ctx = useContext(DemoContext);
  if (ctx === null) throw new Error('useDemo harus dipakai di dalam <DemoProvider>');
  const { store, query } = ctx;
  const pathname = usePathname();
  const month = validMonth(ctx.bulan, ctx.today);
  // Bulan hanya dibawa selama masih di dalam Transaksi; tab lain tidak mewarisinya.
  const inTransaksi = tabFromPathname(pathname) === 'transaksi';
  const keep = inTransaksi ? { value: month, today: ctx.today } : undefined;
  const state = useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.getState(),
    () => store.getState(),
  );
  return {
    state,
    store,
    ruang: ctx.ruang,
    today: ctx.today,
    keypad: ctx.keypad,
    href: (ruang, tab) => buildHref(ruang, tab, query, keep),
    entryHref: (ruang, id) => buildEntryHref(ruang, id, query, keep),
    accountHref: (ruang, id) => buildAccountHref(ruang, id, query),
    authHref: (page) => buildAuthHref(page, query),
    month,
    monthHref: (ruang, m) => buildHref(ruang, 'transaksi', query, { value: m, today: ctx.today }),
  };
}
