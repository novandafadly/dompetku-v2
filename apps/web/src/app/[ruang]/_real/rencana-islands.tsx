'use client';

import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * Pulau klien Rencana nyata, dimuat malas (pola Dompet): page dipakai bersama prototipe, dan kode
 * yang hanya dipakai mode nyata tidak boleh menambah JS muat awal rute prototipe (ADR 0002). SSR
 * tetap merender isi dan tombol lengkap; di browser kodenya menyusul lalu dihidrasi.
 */

const load = () => import('./rencana-client');
const HostLazy = lazy(() => load().then((m) => ({ default: m.RencanaHost })));
const RowLazy = lazy(() => load().then((m) => ({ default: m.BudgetRowTrigger })));
const SetLazy = lazy(() => load().then((m) => ({ default: m.SetBudgetButton })));
const CopyLazy = lazy(() => load().then((m) => ({ default: m.CopyBudgetsButton })));
const NoteLazy = lazy(() => load().then((m) => ({ default: m.CopyConflictNote })));
const BillBodyLazy = lazy(() => load().then((m) => ({ default: m.BillBodyTrigger })));
const AddBillLazy = lazy(() => load().then((m) => ({ default: m.AddBillButton })));
const PayLazy = lazy(() => load().then((m) => ({ default: m.PayButton })));
const UnskipLazy = lazy(() => load().then((m) => ({ default: m.UnskipButton })));

export function RencanaHostIsland(props: ComponentProps<typeof HostLazy>) {
  return (
    <Suspense fallback={null}>
      <HostLazy {...props} />
    </Suspense>
  );
}

export function BudgetRowIsland(props: ComponentProps<typeof RowLazy>) {
  return (
    <Suspense fallback={null}>
      <RowLazy {...props} />
    </Suspense>
  );
}

export function SetBudgetIsland(props: ComponentProps<typeof SetLazy>) {
  return (
    <Suspense fallback={null}>
      <SetLazy {...props} />
    </Suspense>
  );
}

export function CopyBudgetsIsland() {
  return (
    <Suspense fallback={null}>
      <CopyLazy />
    </Suspense>
  );
}

export function CopyConflictIsland() {
  return (
    <Suspense fallback={null}>
      <NoteLazy />
    </Suspense>
  );
}

export function BillBodyIsland(props: ComponentProps<typeof BillBodyLazy>) {
  return (
    <Suspense fallback={null}>
      <BillBodyLazy {...props} />
    </Suspense>
  );
}

export function AddBillIsland(props: ComponentProps<typeof AddBillLazy>) {
  return (
    <Suspense fallback={null}>
      <AddBillLazy {...props} />
    </Suspense>
  );
}

export function PayIsland(props: ComponentProps<typeof PayLazy>) {
  return (
    <Suspense fallback={null}>
      <PayLazy {...props} />
    </Suspense>
  );
}

export function UnskipIsland(props: ComponentProps<typeof UnskipLazy>) {
  return (
    <Suspense fallback={null}>
      <UnskipLazy {...props} />
    </Suspense>
  );
}
