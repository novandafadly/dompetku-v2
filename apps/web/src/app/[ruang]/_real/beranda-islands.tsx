'use client';

import { lazy, Suspense, type ComponentProps } from 'react';
import type { NoSpendButton } from '@/features/beranda/no-spend-button';

/**
 * Pulau klien Beranda nyata, dimuat malas. Halaman tetap dirender lengkap di server (React.lazy
 * di-resolve saat SSR); di browser kodenya dimuat terpisah lalu dihidrasi. Alasannya anggaran JS:
 * page Beranda dipakai bersama prototipe, dan kode yang hanya dipakai mode nyata tidak boleh
 * menambah JS muat awal rute prototipe (ADR 0002, 162 kB).
 */

const load = () => import('./beranda-client');
const NoSpend = lazy(() => load().then((m) => ({ default: m.NoSpendButton })));
const Catat = lazy(() => load().then((m) => ({ default: m.CatatStep })));

export function NoSpendIsland(props: ComponentProps<typeof NoSpendButton>) {
  return (
    <Suspense fallback={null}>
      <NoSpend {...props} />
    </Suspense>
  );
}

export function CatatStepIsland({ label }: { label: string }) {
  return (
    <Suspense fallback={null}>
      <Catat label={label} />
    </Suspense>
  );
}
