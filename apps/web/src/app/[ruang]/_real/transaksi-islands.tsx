'use client';

import { lazy, Suspense } from 'react';

/**
 * Pulau klien Transaksi nyata, dimuat malas (pola Beranda): page dipakai bersama prototipe, dan
 * kode yang hanya dipakai mode nyata tidak boleh menambah JS muat awal rute prototipe (ADR 0002).
 * SSR tetap merender tombolnya lengkap; di browser kodenya menyusul lalu dihidrasi.
 */

const load = () => import('./transaksi-client');
const Catat = lazy(() => load().then((m) => ({ default: m.CatatEmpty })));
const Retry = lazy(() => load().then((m) => ({ default: m.Retry })));

export function CatatEmptyIsland() {
  return (
    <Suspense fallback={null}>
      <Catat />
    </Suspense>
  );
}

export function RetryIsland() {
  return (
    <Suspense fallback={null}>
      <Retry />
    </Suspense>
  );
}
