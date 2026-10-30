'use client';

import dynamic from 'next/dynamic';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import type { Ruang } from '@dompetku/demo-data';
import { DemoBanner } from '@/components/ui/demo-banner';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { Toaster } from '@/components/ui/toast';
import { AppHeader } from './app-header';
import { CatatProvider, type CatatSheetSlotProps } from './catat';
import { Sidebar } from './sidebar';
import { TabBar } from './tab-bar';

// Sheet Menu (Radix Dialog) dimuat saat pertama dibuka.
const MenuSheet = dynamic(() => import('./menu-sheet').then((m) => m.MenuSheet), { ssr: false });

export function AppShell({
  ruang,
  renderCatat,
  preloadCatat,
  children,
}: {
  ruang: Ruang;
  renderCatat: (props: CatatSheetSlotProps) => ReactNode;
  preloadCatat: () => void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuMounted = useOpenedOnce(menuOpen);
  useLayoutEffect(() => {
    document.documentElement.dataset.ruang = ruang;
  }, [ruang]);
  return (
    <CatatProvider renderSheet={renderCatat} preload={preloadCatat}>
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
        <main className="mx-auto w-full max-w-5xl px-4 pt-4 pb-tabbar sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">
          {children}
        </main>
        <TabBar />
        {menuMounted ? <MenuSheet open={menuOpen} onOpenChange={setMenuOpen} /> : null}
        <Toaster />
      </div>
    </CatatProvider>
  );
}
