'use client';

import type { DemoState, DemoStore } from '@dompetku/demo-data';
import type { Route } from 'next';
import { createContext, useContext, useSyncExternalStore } from 'react';
import { buildAuthHref, type AuthPage } from './hrefs';
import { useNav, type NavValue } from './nav-provider';

/**
 * Konteks store demo tanpa seed: layar prototipe membaca store lewat `useDemo`, sedangkan seed dan
 * store dibuat `DemoProvider` (`demo-provider.tsx`) yang hanya dimuat dari cabang prototipe
 * (`DemoRoot`), sehingga JS mode nyata tidak membawa seed demo (K3, ADR 0002).
 */
export interface DemoValue {
  store: DemoStore;
  /** Varian keypad Catat: A keyboard OS, B keypad dalam aplikasi (`?keypad=app`). */
  keypad: 'os' | 'app';
  /** Keadaan data demo (`?state=loading|error`) agar B4/B5/T4 bisa ditinjau dan diuji. */
  dataState: DataState;
  retry: () => void;
}

export type DataState = 'ready' | 'loading' | 'error';

export const DemoContext = createContext<DemoValue | null>(null);

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
