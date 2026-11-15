'use client';

import { lazy, Suspense } from 'react';
import type { ModalActionsProps } from './trading-client';

/**
 * Pulau aksi modal trading, dimuat malas (pola `dompet-actions-islands`): SSR merender tombolnya,
 * kodenya menyusul di browser; sheet-nya dimuat lagi saat pertama dipakai.
 */

const ModalActionsLazy = lazy(() =>
  import('./trading-client').then((m) => ({ default: m.ModalActions })),
);

export function ModalActionsIsland(props: ModalActionsProps) {
  return (
    <Suspense fallback={null}>
      <ModalActionsLazy {...props} />
    </Suspense>
  );
}
