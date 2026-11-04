'use client';

import { lazy, Suspense } from 'react';
import type { ArchiveButtonProps, ReconcileButtonProps } from './dompet-actions-client';

/**
 * Pulau aksi riwayat dompet (Cocokkan saldo, Arsipkan dompet), dimuat malas seperti
 * `dompet-islands`: SSR merender tombolnya; kodenya menyusul di browser. Sheet dan dialognya
 * dimuat lagi saat pertama dipakai (R28).
 */

const load = () => import('./dompet-actions-client');
const Reconcile = lazy(() => load().then((m) => ({ default: m.ReconcileButton })));
const Archive = lazy(() => load().then((m) => ({ default: m.ArchiveButton })));

export function ReconcileIsland(props: ReconcileButtonProps) {
  return (
    <Suspense fallback={null}>
      <Reconcile {...props} />
    </Suspense>
  );
}

export function ArchiveIsland(props: ArchiveButtonProps) {
  return (
    <Suspense fallback={null}>
      <Archive {...props} />
    </Suspense>
  );
}
