'use client';

import type { Ruang } from '@dompetku/demo-data';
import type { Rupiah } from '@dompetku/domain';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { CatatPlaceholder } from '@/features/catat/catat-placeholder';
import { AppShell } from '@/features/shell/app-shell';
import type { CatatSheetSlotProps } from '@/features/shell/catat';
import { useDemo } from '@/features/shell/demo-provider';
import { RUANG_LABEL } from '@/features/shell/hrefs';

// Sheet Catat (dan cmdk di dalamnya) tidak ikut muat awal. Kodenya dimuat saat browser senggang,
// saat pointer/fokus di tombol Catat, atau paling lambat saat sheet dibuka.
const loadCatatSheet = () => import('./catat-demo');
const preloadCatatSheet = () => {
  void loadCatatSheet();
};
const CatatSheet = lazy(() => loadCatatSheet().then((m) => ({ default: m.DemoCatatSheet })));

/** Merangkai shell dengan sheet Catat; fitur tidak saling mengimpor, jadi app/ yang menyambung. */
function CatatSlot(props: CatatSheetSlotProps) {
  const { state, store, today, keypad } = useDemo();
  // Nominal yang diketik di placeholder sebelum sheet termuat; dikosongkan tiap kali dibuka.
  const [early, setEarly] = useState<Rupiah | null>(null);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setEarly(null);
  }
  if (!useOpenedOnce(props.open)) return null;
  const placeholder = props.open ? (
    <CatatPlaceholder
      title={`Pengeluaran · ${RUANG_LABEL[props.ruang]}`}
      tint={props.ruang}
      amount={early}
      onAmountChange={setEarly}
      onClose={() => {
        props.onOpenChange(false);
        props.returnFocus?.focus();
      }}
    />
  ) : null;
  return (
    <Suspense fallback={placeholder}>
      <CatatSheet
        {...props}
        state={state}
        store={store}
        today={today}
        keypad={keypad}
        initialAmount={early}
      />
    </Suspense>
  );
}

export function RuangShell({
  ruang,
  prototype,
  children,
}: {
  ruang: Ruang;
  /** Dari server: sheet Catat masih berbasis store demo; mode nyata memakainya setelah disambung ke ledger. */
  prototype: boolean;
  children: ReactNode;
}) {
  return (
    <AppShell
      ruang={ruang}
      preloadCatat={preloadCatatSheet}
      renderCatat={(props) => (prototype ? <CatatSlot {...props} /> : null)}
    >
      {children}
    </AppShell>
  );
}
