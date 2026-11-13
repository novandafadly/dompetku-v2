'use client';

import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * Pulau klien Utang nyata, dimuat malas (pola Rencana/Kategori): kode yang hanya dipakai mode
 * nyata tidak boleh menambah JS muat awal rute lain (ADR 0002). SSR tetap merender isi dan tombol
 * lengkap; di browser kodenya menyusul lalu dihidrasi. Satu chunk `utang-client`, terpisah dari
 * `rencana-client`.
 */

const load = () => import('./utang-client');
const HostLazy = lazy(() => load().then((m) => ({ default: m.UtangHost })));
const AddLazy = lazy(() => load().then((m) => ({ default: m.AddDebtButton })));
const PayRowLazy = lazy(() => load().then((m) => ({ default: m.PayRowButton })));
const PayDetailLazy = lazy(() => load().then((m) => ({ default: m.PayDetailButton })));
const EditLazy = lazy(() => load().then((m) => ({ default: m.EditDebtButton })));
const DeleteLazy = lazy(() => load().then((m) => ({ default: m.DeleteDebtButton })));
const CancelLazy = lazy(() => load().then((m) => ({ default: m.CancelPaymentButton })));
const RestoreLazy = lazy(() => load().then((m) => ({ default: m.RestoreDebtButton })));

export function UtangHostIsland(props: ComponentProps<typeof HostLazy>) {
  return (
    <Suspense fallback={null}>
      <HostLazy {...props} />
    </Suspense>
  );
}

export function AddDebtIsland(props: ComponentProps<typeof AddLazy>) {
  return (
    <Suspense fallback={null}>
      <AddLazy {...props} />
    </Suspense>
  );
}

export function PayRowIsland(props: ComponentProps<typeof PayRowLazy>) {
  return (
    <Suspense fallback={null}>
      <PayRowLazy {...props} />
    </Suspense>
  );
}

export function PayDetailIsland(props: ComponentProps<typeof PayDetailLazy>) {
  return (
    <Suspense fallback={null}>
      <PayDetailLazy {...props} />
    </Suspense>
  );
}

export function EditDebtIsland() {
  return (
    <Suspense fallback={null}>
      <EditLazy />
    </Suspense>
  );
}

export function DeleteDebtIsland() {
  return (
    <Suspense fallback={null}>
      <DeleteLazy />
    </Suspense>
  );
}

export function CancelPaymentIsland(props: ComponentProps<typeof CancelLazy>) {
  return (
    <Suspense fallback={null}>
      <CancelLazy {...props} />
    </Suspense>
  );
}

export function RestoreDebtIsland(props: ComponentProps<typeof RestoreLazy>) {
  return (
    <Suspense fallback={null}>
      <RestoreLazy {...props} />
    </Suspense>
  );
}
