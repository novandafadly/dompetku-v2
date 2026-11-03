'use client';

import { lazy, Suspense, type ComponentProps } from 'react';
import type { KategoriBack, KategoriManager } from './kategori-client';

/**
 * Pulau klien Kategori nyata, dimuat malas (pola Sampah/Detail): kode yang hanya dipakai mode
 * nyata tidak boleh menambah JS muat awal rute lain (ADR 0002). SSR tetap merender daftarnya
 * lengkap; di browser kodenya menyusul lalu dihidrasi.
 */

const load = () => import('./kategori-client');
const Manager = lazy(() => load().then((m) => ({ default: m.KategoriManager })));
const Back = lazy(() => load().then((m) => ({ default: m.KategoriBack })));

export function KategoriManagerIsland(props: ComponentProps<typeof KategoriManager>) {
  return (
    <Suspense fallback={null}>
      <Manager {...props} />
    </Suspense>
  );
}

export function KategoriBackIsland(props: ComponentProps<typeof KategoriBack>) {
  return (
    <Suspense fallback={null}>
      <Back {...props} />
    </Suspense>
  );
}
