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
  /** Ke mana fokus kembali saat sheet ditutup: pemicu, atau tombol Catat yang terlihat. */
  returnFocus: HTMLElement | null;
}

function focusTarget(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) return active;
  return (
    // Tombol Catat di tab bar/sidebar bertanda data-catat-trigger; pilih yang sedang tampil.
    [...document.querySelectorAll<HTMLElement>('[data-catat-trigger]')].find(
      (el) => el.getClientRects().length > 0,
    ) ?? null
  );
}

type OpenCatat = (opts?: OpenCatatOptions) => void;

const CatatContext = createContext<OpenCatat | null>(null);
const PreloadContext = createContext<() => void>(() => undefined);

/** Mulai memuat kode sheet Catat (mis. saat pointer/fokus di tombol Catat). */
export function usePreloadCatat(): () => void {
  return useContext(PreloadContext);
}

/** Muat kode sheet Catat saat browser senggang setelah hidrasi. */
function useIdlePreload(preload: () => void) {
  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preload, { timeout: 2000 });
      return () => {
        window.cancelIdleCallback(id);
      };
    }
    const id = setTimeout(preload, 1);
    return () => {
      clearTimeout(id);
    };
  }, [preload]);
}

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
  preload,
  children,
}: {
  renderSheet: (props: CatatSheetSlotProps) => ReactNode;
  /** Memuat kode sheet lebih awal; harus stabil (identitas tetap). */
  preload: () => void;
  children: ReactNode;
}) {
  const { ruang } = useDemo();
  const [sheet, setSheet] = useState<{
    open: boolean;
    ruang: Ruang;
    returnFocus: HTMLElement | null;
  }>({ open: false, ruang, returnFocus: null });
  const openCatat = useCallback<OpenCatat>(
    (opts) => {
      setSheet({ open: true, ruang: opts?.ruang ?? ruang, returnFocus: focusTarget() });
    },
    [ruang],
  );
  useIdlePreload(preload);
  const shortcut = useCallback(() => {
    openCatat();
  }, [openCatat]);
  useCatatShortcut(shortcut);
  const onOpenChange = useCallback((open: boolean) => {
    setSheet((s) => ({ ...s, open }));
  }, []);
  return (
    <CatatContext.Provider value={openCatat}>
      <PreloadContext.Provider value={preload}>
        {children}
        {renderSheet({
          open: sheet.open,
          onOpenChange,
          ruang: sheet.ruang,
          returnFocus: sheet.returnFocus,
        })}
      </PreloadContext.Provider>
    </CatatContext.Provider>
  );
}
