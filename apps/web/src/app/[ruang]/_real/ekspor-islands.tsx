'use client';

import { lazy, Suspense, type ComponentProps } from 'react';

/** Pulau klien Ekspor, dimuat malas (pola `review-islands`): kode hanya dipakai mode nyata. */
const ExportLazy = lazy(() => import('./ekspor-client').then((m) => ({ default: m.ExportButton })));

export function ExportIsland(props: ComponentProps<typeof ExportLazy>) {
  return (
    <Suspense fallback={null}>
      <ExportLazy {...props} />
    </Suspense>
  );
}
