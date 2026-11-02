'use client';

import { lazy, Suspense } from 'react';
import type { AddWalletHostProps } from './dompet-client';

/**
 * Pulau klien Dompet nyata, dimuat malas (pola Transaksi): page dipakai bersama prototipe, dan kode
 * yang hanya dipakai mode nyata tidak boleh menambah JS muat awal rute prototipe (ADR 0002).
 * SSR tetap merender isi dan tombolnya lengkap; di browser kodenya menyusul lalu dihidrasi.
 */

const load = () => import('./dompet-client');
const Host = lazy(() => load().then((m) => ({ default: m.AddWalletHost })));
const Trigger = lazy(() => load().then((m) => ({ default: m.AddWalletTrigger })));

export function AddWalletHostIsland(props: AddWalletHostProps) {
  return (
    <Suspense fallback={null}>
      <Host {...props} />
    </Suspense>
  );
}

export function AddWalletTriggerIsland({ className }: { className?: string }) {
  return (
    <Suspense fallback={null}>
      <Trigger {...(className === undefined ? {} : { className })} />
    </Suspense>
  );
}
