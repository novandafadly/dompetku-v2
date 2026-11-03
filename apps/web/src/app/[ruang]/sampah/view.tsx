'use client';

import { lazy, Suspense } from 'react';
import { TrashLoading } from '@/features/sampah/trash-states';

/**
 * Sampah prototipe. Daftar dan alur Pulihkan dimuat malas: rute ini tidak boleh menambah JS muat
 * dingin di atas bawaan shell (ADR 0002, 162 kB). SSR tetap merender isinya penuh.
 */
const Body = lazy(() => import('./demo-body'));

export function SampahPage() {
  return (
    <Suspense fallback={<TrashLoading />}>
      <Body />
    </Suspense>
  );
}
