'use client';

import type { Ruang } from '@dompetku/demo-data';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { shouldOpenCatat } from './catat-shortcut';
import { useDemo } from './demo-provider';

export interface OpenCatatOptions {
  /** Ruang tujuan; bawaan ruang di URL. */
  ruang?: Ruang;
}

/** Props untuk sheet Catat yang dipasang app/ (shell tidak mengimpor fitur lain). */
export interface CatatSheetSlotProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruang: Ruang;
}

type OpenCatat = (opts?: OpenCatatOptions) => void;

const CatatContext = createContext<OpenCatat | null>(null);

export function useOpenCatat(): OpenCatat {
  const ctx = useContext(CatatContext);
  if (ctx === null) throw new Error('useOpenCatat harus dipakai di dalam <CatatProvider>');
  return ctx;
}

function useCatatShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shouldOpenCatat(e)) return;
      e.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
}

export function CatatProvider({
  renderSheet,
  children,
}: {
  renderSheet: (props: CatatSheetSlotProps) => ReactNode;
  children: ReactNode;
}) {
  const { ruang } = useDemo();
  const [sheet, setSheet] = useState<{ open: boolean; ruang: Ruang }>({ open: false, ruang });
  const openCatat = useCallback<OpenCatat>(
    (opts) => {
      setSheet({ open: true, ruang: opts?.ruang ?? ruang });
    },
    [ruang],
  );
  const shortcut = useCallback(() => {
    openCatat();
  }, [openCatat]);
  useCatatShortcut(shortcut);
  const onOpenChange = useCallback((open: boolean) => {
    setSheet((s) => ({ ...s, open }));
  }, []);
  return (
    <CatatContext.Provider value={openCatat}>
      {children}
      {renderSheet({ open: sheet.open, onOpenChange, ruang: sheet.ruang })}
    </CatatContext.Provider>
  );
}
