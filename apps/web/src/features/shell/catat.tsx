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
import { shouldOpenCatat } from './catat-shortcut';
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
