'use client';

import type { DemoState, DemoStore } from '@dompetku/demo-data';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { CatatSheet, type CatatSheetProps } from '@/features/catat/catat-sheet';
import { demoCatatSource } from '@/features/catat/demo-source';
import { useNav } from '@/features/shell/nav-provider';

/**
 * Sheet Catat prototipe: `demoCatatSource` di atas store demo. Dimuat malas bersama sheet, jadi
 * sumber demo tidak ikut JS muat awal rute.
 */
export function DemoCatatSheet({
  state,
  store,
  ...props
}: Omit<CatatSheetProps, 'source' | 'onAddAccount'> & { state: DemoState; store: DemoStore }) {
  const nav = useNav();
  const router = useRouter();
  const source = useMemo(() => demoCatatSource(state, store), [state, store]);
  return (
    <CatatSheet
      {...props}
      source={source}
      onAddAccount={(r) => {
        router.push(nav.href(r, 'dompet'));
      }}
    />
  );
}
