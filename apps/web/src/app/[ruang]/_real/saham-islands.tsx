'use client';

import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * Pulau klien saham nyata, dimuat malas (pola Aset/Tujuan): kode tombol dan sheet tidak ikut JS muat
 * awal rute lain (ADR 0002). SSR tetap merender tombolnya; di browser kodenya menyusul.
 */

const load = () => import('./saham-client');
const ButtonLazy = lazy(() => load().then((m) => ({ default: m.StockButton })));
const VoidLazy = lazy(() => load().then((m) => ({ default: m.VoidTradeButton })));

export function StockButtonIsland(props: ComponentProps<typeof ButtonLazy>) {
  return (
    <Suspense fallback={null}>
      <ButtonLazy {...props} />
    </Suspense>
  );
}

export function VoidTradeIsland(props: ComponentProps<typeof VoidLazy>) {
  return (
    <Suspense fallback={null}>
      <VoidLazy {...props} />
    </Suspense>
  );
}
