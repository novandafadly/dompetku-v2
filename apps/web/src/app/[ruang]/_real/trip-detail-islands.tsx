'use client';

import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * Pulau klien Detail trip nyata, dimuat malas (chunk terpisah dari daftar Trip): SSR merender
 * hero, anggaran, rincian, dan daftar pengeluaran; kontrol interaktif menyusul di browser.
 */

const load = () => import('./trip-detail-client');
const HostLazy = lazy(() => load().then((m) => ({ default: m.TripDetailHost })));
const EditLazy = lazy(() => load().then((m) => ({ default: m.EditTripButton })));
const AddBudgetLazy = lazy(() => load().then((m) => ({ default: m.AddTripBudgetButton })));
const ArchiveLazy = lazy(() => load().then((m) => ({ default: m.ArchiveTripButton })));
const ImportLazy = lazy(() => load().then((m) => ({ default: m.ImportEntriesButton })));
const RemoveLazy = lazy(() => load().then((m) => ({ default: m.RemoveTripEntryButton })));

export function TripDetailHostIsland(props: ComponentProps<typeof HostLazy>) {
  return (
    <Suspense fallback={null}>
      <HostLazy {...props} />
    </Suspense>
  );
}

export function EditTripIsland() {
  return (
    <Suspense fallback={null}>
      <EditLazy />
    </Suspense>
  );
}

export function AddTripBudgetIsland() {
  return (
    <Suspense fallback={null}>
      <AddBudgetLazy />
    </Suspense>
  );
}

export function ArchiveTripIsland() {
  return (
    <Suspense fallback={null}>
      <ArchiveLazy />
    </Suspense>
  );
}

export function ImportEntriesIsland(props: ComponentProps<typeof ImportLazy>) {
  return (
    <Suspense fallback={null}>
      <ImportLazy {...props} />
    </Suspense>
  );
}

export function RemoveTripEntryIsland(props: ComponentProps<typeof RemoveLazy>) {
  return (
    <Suspense fallback={null}>
      <RemoveLazy {...props} />
    </Suspense>
  );
}
