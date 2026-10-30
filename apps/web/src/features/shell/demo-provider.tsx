'use client';

import { addDays, todayWIB } from '@dompetku/domain';
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
import { buildEntryHref, buildHref, isRuang, keptQuery, type Tab } from './hrefs';

interface DemoValue {
  store: DemoStore;
  ruang: Ruang;
  today: IsoDate;
  hero: 'serif' | 'sans';
  /** Varian keypad Catat: A keyboard OS, B keypad dalam aplikasi (`?keypad=app`). */
  keypad: 'os' | 'app';
  query: string;
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

function DemoProviderInner({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();
  // Query dibaca sekali saat mount; navigasi berikutnya tidak membuat ulang store.
  const [boot] = useState(() => {
    const today = validToday(params.get('today'));
    const variant = params.get('seed') === 'empty' ? 'empty' : 'full';
    const hero = params.get('hero') === 'sans' ? 'sans' : 'serif';
    const keypad = params.get('keypad') === 'app' ? 'app' : 'os';
    return {
      today,
      hero,
      keypad,
      query: keptQuery(params),
      store: createDemoStore(createSeed({ today, variant })),
    } as const;
  });

  useLayoutEffect(() => {
    document.documentElement.dataset.hero = boot.hero;
  }, [boot.hero]);

  const segment = pathname.split('/')[1];
  const ruang: Ruang = isRuang(segment) ? segment : 'pribadi';

  return <DemoContext.Provider value={{ ...boot, ruang }}>{children}</DemoContext.Provider>;
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
} {
  const ctx = useContext(DemoContext);
  if (ctx === null) throw new Error('useDemo harus dipakai di dalam <DemoProvider>');
  const { store, query } = ctx;
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
    href: (ruang, tab) => buildHref(ruang, tab, query),
    entryHref: (ruang, id) => buildEntryHref(ruang, id, query),
  };
}
