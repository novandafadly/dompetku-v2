'use client';

import { isoAtWIB, nowIsoWIB } from '@dompetku/domain';
import type { IsoDate } from '@dompetku/domain';
import { createDemoStore, createSeed } from '@dompetku/demo-data';
import type { DemoState, DemoStore, Ruang } from '@dompetku/demo-data';
import type { Route } from 'next';
import { useSearchParams } from 'next/navigation';
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { buildAuthHref, type AuthPage } from './hrefs';
import { RencanaContext } from './nav-items';
import { useNav, type NavValue } from './nav-provider';

interface DemoValue {
  store: DemoStore;
  /** Varian keypad Catat: A keyboard OS, B keypad dalam aplikasi (`?keypad=app`). */
  keypad: 'os' | 'app';
  /** Keadaan data demo (`?state=loading|error`) agar B4/B5/T4 bisa ditinjau dan diuji. */
  dataState: DataState;
  retry: () => void;
}

export type DataState = 'ready' | 'loading' | 'error';

const DemoContext = createContext<DemoValue | null>(null);

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

/** Dipasang di dalam NavProvider (Suspense-nya sudah menutup pembacaan `useSearchParams`). */
export function DemoProvider({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const { today, dropParam } = useNav();
  // Query dibaca sekali saat mount; navigasi berikutnya tidak membuat ulang store.
  const [boot] = useState(() => {
    const variant = params.get('seed') === 'empty' ? 'empty' : 'full';
    const keypad = params.get('keypad') === 'app' ? 'app' : 'os';
    const store: DemoStore = createDemoStore(createSeed({ today, variant }), {
      clock: demoClock(today, () => store),
    });
    // Anggaran dan tagihan tidak berubah selama sesi demo, jadi Rencana cukup dihitung sekali.
    const { budgets, bills } = store.getState();
    const has = (r: Ruang) =>
      budgets.some((b) => b.ruang === r) || bills.some((b) => b.ruang === r);
    return {
      keypad,
      store,
      rencana: { pribadi: has('pribadi'), bersama: has('bersama') },
    } as const;
  });
  const [dataState, setDataState] = useState<DataState>(() => {
    const raw = params.get('state');
    return raw === 'loading' || raw === 'error' ? raw : 'ready';
  });
  const retry = () => {
    setDataState('ready');
    dropParam('state');
  };

  return (
    <DemoContext.Provider value={{ store: boot.store, keypad: boot.keypad, dataState, retry }}>
      <RencanaContext.Provider value={boot.rencana}>{children}</RencanaContext.Provider>
    </DemoContext.Provider>
  );
}

/** Navigasi (lihat NavValue) ditambah store demo; `retry` membuang `?state` dari tautan. */
export type DemoView = NavValue &
  DemoValue & {
    state: DemoState;
    /** Alamat layar auth tiruan dengan query demo yang dipertahankan. */
    authHref: (page: AuthPage) => Route;
  };

export function useDemo(): DemoView {
  const ctx = useContext(DemoContext);
  if (ctx === null) throw new Error('useDemo harus dipakai di dalam <DemoProvider>');
  const nav = useNav();
  const state = useSyncExternalStore(
    (fn) => ctx.store.subscribe(fn),
    () => ctx.store.getState(),
    () => ctx.store.getState(),
  );
  return { ...nav, ...ctx, state, authHref: (page) => buildAuthHref(page, nav.query) };
}
