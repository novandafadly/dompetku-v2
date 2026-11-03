'use client';

import { lazy, Suspense } from 'react';
import type { DetailActionsProps, RestoreActionProps } from './detail-client';

/**
 * Pulau klien Detail nyata, dimuat malas (pola Transaksi): page dipakai bersama prototipe, dan kode
 * yang hanya dipakai mode nyata tidak boleh menambah JS muat awal rute prototipe (ADR 0002).
 * SSR tetap merender tombolnya lengkap; di browser kodenya menyusul lalu dihidrasi. Sheet Ubah dan
 * dialog Batalkan dimuat lagi terpisah, saat pertama dipakai.
 */

const load = () => import('./detail-client');
const Actions = lazy(() => load().then((m) => ({ default: m.DetailActions })));
const Restore = lazy(() => load().then((m) => ({ default: m.RestoreAction })));

export function DetailActionsIsland(props: DetailActionsProps) {
  return (
    <Suspense fallback={null}>
      <Actions {...props} />
    </Suspense>
  );
}

export function RestoreIsland(props: RestoreActionProps) {
  return (
    <Suspense fallback={null}>
      <Restore {...props} />
    </Suspense>
  );
}
