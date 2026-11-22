'use client';

import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * Pulau klien Aset nyata, dimuat malas (pola Tujuan/Dompet): kode sheet dan tombol tidak menambah
 * JS muat awal rute lain (ADR 0002). SSR tetap merender tombolnya; di browser kodenya menyusul.
 */

const load = () => import('./aset-client');
const HostLazy = lazy(() => load().then((m) => ({ default: m.AddAssetHost })));
const TriggerLazy = lazy(() => load().then((m) => ({ default: m.AddAssetTrigger })));
const RevalueLazy = lazy(() => load().then((m) => ({ default: m.RevalueButton })));
const TransferLazy = lazy(() => load().then((m) => ({ default: m.AssetTransferButtons })));

export function AddAssetHostIsland(props: ComponentProps<typeof HostLazy>) {
  return (
    <Suspense fallback={null}>
      <HostLazy {...props} />
    </Suspense>
  );
}

export function AddAssetTriggerIsland(props: ComponentProps<typeof TriggerLazy>) {
  return (
    <Suspense fallback={null}>
      <TriggerLazy {...props} />
    </Suspense>
  );
}

export function RevalueIsland(props: ComponentProps<typeof RevalueLazy>) {
  return (
    <Suspense fallback={null}>
      <RevalueLazy {...props} />
    </Suspense>
  );
}

export function AssetTransferIsland(props: ComponentProps<typeof TransferLazy>) {
  return (
    <Suspense fallback={null}>
      <TransferLazy {...props} />
    </Suspense>
  );
}
