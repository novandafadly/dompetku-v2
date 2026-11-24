'use client';

import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * Pulau klien daftar Trip nyata, dimuat malas (pola Kontak/Tujuan): SSR tetap merender daftar
 * lengkap; kode interaktif menyusul di browser agar budget JS halaman ≤ 152 kB (ADR 0002).
 */

const load = () => import('./trip-client');
const HostLazy = lazy(() => load().then((m) => ({ default: m.TripListHost })));
const AddLazy = lazy(() => load().then((m) => ({ default: m.AddTripButton })));
const RestoreLazy = lazy(() => load().then((m) => ({ default: m.RestoreTripButton })));

export function TripListHostIsland(props: ComponentProps<typeof HostLazy>) {
  return (
    <Suspense fallback={null}>
      <HostLazy {...props} />
    </Suspense>
  );
}

export function AddTripIsland(props: ComponentProps<typeof AddLazy>) {
  return (
    <Suspense fallback={null}>
      <AddLazy {...props} />
    </Suspense>
  );
}

export function RestoreTripIsland(props: ComponentProps<typeof RestoreLazy>) {
  return (
    <Suspense fallback={null}>
      <RestoreLazy {...props} />
    </Suspense>
  );
}
