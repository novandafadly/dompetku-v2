'use client';

import { lazy, Suspense, type ComponentProps } from 'react';

/** Pulau klien Review, dimuat malas (pola `rencana-islands`): kode hanya dipakai mode nyata. */
const CopyLazy = lazy(() => import('./review-client').then((m) => ({ default: m.ReviewCopyCard })));

export function ReviewCopyIsland(props: ComponentProps<typeof CopyLazy>) {
  return (
    <Suspense fallback={null}>
      <CopyLazy {...props} />
    </Suspense>
  );
}
