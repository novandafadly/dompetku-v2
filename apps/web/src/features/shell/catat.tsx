'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Sheet } from '@/components/ui/sheet';
import { useDemo } from './demo-provider';

interface CatatValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CatatContext = createContext<CatatValue | null>(null);

export function useCatat(): CatatValue {
  const ctx = useContext(CatatContext);
  if (ctx === null) throw new Error('useCatat harus dipakai di dalam <CatatProvider>');
  return ctx;
}

function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Pintasan `c` (WCAG 2.1.4): mati bila fokus di field teks, ada modifier, atau dialog terbuka. */
function useCatatShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'c' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTextField(e.target) || document.querySelector('[role="dialog"]') !== null) return;
      e.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
}

export function CatatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { ruang } = useDemo();
  const show = useCallback(() => {
    setOpen(true);
  }, []);
  useCatatShortcut(show);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return (
    <CatatContext.Provider value={value}>
      {children}
      <Sheet open={open} onOpenChange={setOpen} title="Catat" tint={ruang}>
        <p className="text-base text-text-muted">Form catat menyusul.</p>
      </Sheet>
    </CatatContext.Provider>
  );
}
