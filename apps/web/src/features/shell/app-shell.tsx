'use client';

import { useLayoutEffect, useState, type ReactNode } from 'react';
import type { Ruang } from '@dompetku/demo-data';
import { DemoBanner } from '@/components/ui/demo-banner';
import { Toaster } from '@/components/ui/toast';
import { AppHeader } from './app-header';
import { CatatProvider, type CatatSheetSlotProps } from './catat';
import { MenuSheet } from './menu-sheet';
import { Sidebar } from './sidebar';
import { TabBar } from './tab-bar';

export function AppShell({
  ruang,
  renderCatat,
  children,
}: {
  ruang: Ruang;
  renderCatat: (props: CatatSheetSlotProps) => ReactNode;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useLayoutEffect(() => {
    document.documentElement.dataset.ruang = ruang;
  }, [ruang]);
  return (
    <CatatProvider renderSheet={renderCatat}>
      <div className="min-h-dvh lg:pl-62">
        <DemoBanner />
        <AppHeader
          onMenu={() => {
            setMenuOpen(true);
          }}
        />
        <Sidebar
          onMenu={() => {
            setMenuOpen(true);
          }}
        />
        <main className="mx-auto max-w-2xl px-4 pt-4 pb-24 lg:pb-8">{children}</main>
        <TabBar />
        <MenuSheet open={menuOpen} onOpenChange={setMenuOpen} />
        <Toaster />
      </div>
    </CatatProvider>
  );
}
