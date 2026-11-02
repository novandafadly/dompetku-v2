'use client';

import type { IsoDate } from '@dompetku/domain';
import { lazy, useMemo, type ReactNode } from 'react';
import type { CatatOptions } from '@/features/catat/source';
import type { Ruang } from '@/features/ledger/types';
import { AppShell } from '@/features/shell/app-shell';
import { CatatSlot } from './catat-slot';

/**
 * Shell ruang untuk kedua mode: satu komponen klien di layout (satu entri klien, JS muat awal
 * tetap kecil). Sheet Catat (dan cmdk di dalamnya) tidak ikut muat awal; kodenya dimuat saat
 * browser senggang, saat pointer/fokus di tombol Catat, atau paling lambat saat sheet dibuka.
 * - Prototipe (`real` kosong): sheet demo di atas store demo (`catat-demo`).
 * - Nyata (`real` diisi `RuangShellReal`): sheet `realCatatSource` (`_real/catat-real`); chunk
 *   demo tidak pernah dimuat dan DemoProvider tidak dibaca (tes `ruang-shell.test.tsx`).
 */

const loadDemo = () => import('./catat-demo');
const preloadDemo = () => {
  void loadDemo();
};
const DemoSheet = lazy(() => loadDemo().then((m) => ({ default: m.DemoCatatSheet })));

const loadReal = () => import('./_real/catat-real');
const preloadReal = () => {
  void loadReal();
};
const RealSheet = lazy(() => loadReal().then((m) => ({ default: m.RealCatatSheet })));

/** Opsi Catat mode nyata dari layout server: ruang halaman ini saja. */
export interface RealCatat {
  options: CatatOptions;
  /** Hari ini WIB dari server. */
  today: IsoDate;
}

const NO_EXTRA = {};

export function RuangShell({
  ruang,
  real,
  children,
}: {
  ruang: Ruang;
  real?: RealCatat | undefined;
  children: ReactNode;
}) {
  const extra = useMemo(
    () => (real === undefined ? undefined : { home: ruang, ...real }),
    [ruang, real],
  );
  return (
    <AppShell
      ruang={ruang}
      preloadCatat={extra === undefined ? preloadDemo : preloadReal}
      demo={extra === undefined}
      renderCatat={(props) =>
        extra === undefined ? (
          <CatatSlot {...props} Sheet={DemoSheet} extra={NO_EXTRA} />
        ) : (
          <CatatSlot {...props} Sheet={RealSheet} extra={extra} />
        )
      }
    >
      {children}
    </AppShell>
  );
}
