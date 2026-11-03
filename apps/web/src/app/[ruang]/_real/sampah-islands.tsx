'use client';

import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * Pulau klien Sampah nyata, dimuat malas (pola Transaksi/Detail): page dipakai bersama prototipe,
 * dan kode yang hanya dipakai mode nyata tidak boleh menambah JS muat awal rute prototipe (ADR 0002).
 * SSR tetap merender daftarnya lengkap; di browser kodenya menyusul lalu dihidrasi.
 */

const load = () => import('./sampah-client');
const List = lazy(() => load().then((m) => ({ default: m.TrashListReal })));

export function TrashListIsland(props: ComponentProps<typeof List>) {
  return (
    <Suspense fallback={null}>
      <List {...props} />
    </Suspense>
  );
}
