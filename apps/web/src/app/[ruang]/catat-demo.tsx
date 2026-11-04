'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { CatatSheet } from '@/features/catat/catat-sheet';
import { demoCatatSource } from '@/features/catat/demo-source';
import { useDemo } from '@/features/shell/demo-context';
import { useNav } from '@/features/shell/nav-provider';
import type { LazySheetProps } from './catat-slot';

/**
 * Sheet Catat prototipe: `demoCatatSource` di atas store demo. Dimuat malas bersama sheet, jadi
 * sumber demo tidak ikut JS muat awal rute.
 */
export function DemoCatatSheet(props: LazySheetProps) {
  const { state, store, today, keypad } = useDemo();
  const nav = useNav();
  const router = useRouter();
  const source = useMemo(() => demoCatatSource(state, store), [state, store]);
  return (
    <CatatSheet
      {...props}
      source={source}
      today={today}
      keypad={keypad}
      onAddAccount={(r) => {
        router.push(nav.href(r, 'dompet'));
      }}
    />
  );
}
