'use client';

import type { Ruang } from '@dompetku/demo-data';
import type { ReactNode } from 'react';
import { CatatSheet } from '@/features/catat/catat-sheet';
import { AppShell } from '@/features/shell/app-shell';
import type { CatatSheetSlotProps } from '@/features/shell/catat';
import { useDemo } from '@/features/shell/demo-provider';
import { RUANG_LABEL } from '@/features/shell/hrefs';

/** Merangkai shell dengan sheet Catat; fitur tidak saling mengimpor, jadi app/ yang menyambung. */
function CatatSlot(props: CatatSheetSlotProps) {
  const { state, store, today, keypad } = useDemo();
  return (
    <CatatSheet
      {...props}
      state={state}
      store={store}
      today={today}
      keypad={keypad}
      ruangLabel={RUANG_LABEL}
    />
  );
}

export function RuangShell({ ruang, children }: { ruang: Ruang; children: ReactNode }) {
  return (
    <AppShell ruang={ruang} renderCatat={(props) => <CatatSlot {...props} />}>
      {children}
    </AppShell>
  );
}
