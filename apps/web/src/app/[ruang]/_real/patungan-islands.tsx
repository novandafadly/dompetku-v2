'use client';

import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * Pulau klien Patungan nyata, dimuat malas (pola Utang/Kontak): SSR tetap merender isi dan tombol
 * lengkap; di browser kodenya menyusul lalu dihidrasi (ADR 0002). Satu chunk `patungan-client`.
 */

const load = () => import('./patungan-client');
const HostLazy = lazy(() => load().then((m) => ({ default: m.PatunganHost })));
const SettleLazy = lazy(() => load().then((m) => ({ default: m.SettleButton })));
const ReceiveLazy = lazy(() => load().then((m) => ({ default: m.ReceiveButton })));
const ActionLazy = lazy(() => load().then((m) => ({ default: m.RowActionButton })));
const CatatLazy = lazy(() => load().then((m) => ({ default: m.CatatButton })));
const RestoreLazy = lazy(() => load().then((m) => ({ default: m.RestoreSplitButton })));

export function PatunganHostIsland(props: ComponentProps<typeof HostLazy>) {
  return (
    <Suspense fallback={null}>
      <HostLazy {...props} />
    </Suspense>
  );
}

export function SettleIsland(props: ComponentProps<typeof SettleLazy>) {
  return (
    <Suspense fallback={null}>
      <SettleLazy {...props} />
    </Suspense>
  );
}

export function ReceiveIsland(props: ComponentProps<typeof ReceiveLazy>) {
  return (
    <Suspense fallback={null}>
      <ReceiveLazy {...props} />
    </Suspense>
  );
}

export function RowActionIsland(props: ComponentProps<typeof ActionLazy>) {
  return (
    <Suspense fallback={null}>
      <ActionLazy {...props} />
    </Suspense>
  );
}

export function RestoreSplitIsland(props: ComponentProps<typeof RestoreLazy>) {
  return (
    <Suspense fallback={null}>
      <RestoreLazy {...props} />
    </Suspense>
  );
}

export function CatatIsland(props: ComponentProps<typeof CatatLazy>) {
  return (
    <Suspense fallback={null}>
      <CatatLazy {...props} />
    </Suspense>
  );
}
