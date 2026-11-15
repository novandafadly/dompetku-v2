'use client';

import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * Pulau klien Tujuan nyata, dimuat malas (pola Utang/Rencana): kode sheet, dialog, dan tombol tidak
 * menambah JS muat awal rute lain (ADR 0002). SSR tetap merender tombol lengkap; di browser kodenya
 * menyusul lalu dihidrasi. Satu chunk `tujuan-client`.
 */

const load = () => import('./tujuan-client');
const HostLazy = lazy(() => load().then((m) => ({ default: m.TujuanHost })));
const AddLazy = lazy(() => load().then((m) => ({ default: m.AddGoalButton })));
const EditLazy = lazy(() => load().then((m) => ({ default: m.EditGoalButton })));
const ArchiveLazy = lazy(() => load().then((m) => ({ default: m.ArchiveGoalButton })));
const CompleteLazy = lazy(() => load().then((m) => ({ default: m.CompleteGoalButton })));
const RestoreLazy = lazy(() => load().then((m) => ({ default: m.RestoreGoalButton })));

export function TujuanHostIsland(props: ComponentProps<typeof HostLazy>) {
  return (
    <Suspense fallback={null}>
      <HostLazy {...props} />
    </Suspense>
  );
}

export function AddGoalIsland(props: ComponentProps<typeof AddLazy>) {
  return (
    <Suspense fallback={null}>
      <AddLazy {...props} />
    </Suspense>
  );
}

export function EditGoalIsland(props: ComponentProps<typeof EditLazy>) {
  return (
    <Suspense fallback={null}>
      <EditLazy {...props} />
    </Suspense>
  );
}

export function ArchiveGoalIsland(props: ComponentProps<typeof ArchiveLazy>) {
  return (
    <Suspense fallback={null}>
      <ArchiveLazy {...props} />
    </Suspense>
  );
}

export function CompleteGoalIsland(props: ComponentProps<typeof CompleteLazy>) {
  return (
    <Suspense fallback={null}>
      <CompleteLazy {...props} />
    </Suspense>
  );
}

export function RestoreGoalIsland(props: ComponentProps<typeof RestoreLazy>) {
  return (
    <Suspense fallback={null}>
      <RestoreLazy {...props} />
    </Suspense>
  );
}
