'use client';

import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * Pulau klien Kontak nyata, dimuat malas (pola Kategori/Utang): SSR tetap merender daftar dan
 * tombol lengkap; di browser kodenya menyusul lalu dihidrasi (ADR 0002).
 */

const load = () => import('./kontak-client');
const HostLazy = lazy(() => load().then((m) => ({ default: m.KontakHost })));
const RowLazy = lazy(() => load().then((m) => ({ default: m.ContactRowTrigger })));
const AddLazy = lazy(() => load().then((m) => ({ default: m.AddContactButton })));

export function KontakHostIsland(props: ComponentProps<typeof HostLazy>) {
  return (
    <Suspense fallback={null}>
      <HostLazy {...props} />
    </Suspense>
  );
}

export function ContactRowIsland(props: ComponentProps<typeof RowLazy>) {
  return (
    <Suspense fallback={null}>
      <RowLazy {...props} />
    </Suspense>
  );
}

export function AddContactIsland(props: ComponentProps<typeof AddLazy>) {
  return (
    <Suspense fallback={null}>
      <AddLazy {...props} />
    </Suspense>
  );
}
