'use client';

import { lazy, Suspense, useLayoutEffect, useState, type ReactNode } from 'react';
import type { Ruang } from '@dompetku/demo-data';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { Toaster } from '@/components/ui/toast';
import { AppHeader } from './app-header';
import { CatatProvider, type CatatSheetSlotProps } from './catat';
import { Sidebar } from './sidebar';
import { TabBar } from './tab-bar';

// Sheet Menu (Radix Dialog) dimuat saat pertama dibuka. React.lazy, bukan next/dynamic: runtime
// next/dynamic (~1,5 kB gzip) tidak ikut muat awal (ADR 0002).
const MenuSheet = lazy(() => import('./menu-sheet').then((m) => ({ default: m.MenuSheet })));

export function AppShell({
  ruang,
  renderCatat,
  preloadCatat,
  demo,
  children,
}: {
  ruang: Ruang;
  /** Prototipe: penanda "Data demo" di header dan sidebar. Mode nyata: `false`. */
  demo: boolean;
  renderCatat: (props: CatatSheetSlotProps) => ReactNode;
  preloadCatat: () => void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuMounted = useOpenedOnce(menuOpen);
  useLayoutEffect(() => {
    document.documentElement.dataset.ruang = ruang;
  }, [ruang]);
  const openMenu = () => {
    setMenuOpen(true);
  };
  return (
    <CatatProvider renderSheet={renderCatat} preload={preloadCatat}>
      <div className="min-h-dvh laptop:pl-62">
        <AppHeader onMenu={openMenu} demo={demo} />
        <Sidebar onMenu={openMenu} demo={demo} />
        {/* HP: padding 12, jarak 12. Tablet: isi maks 720, padding 24. Laptop: rata kiri, isi maks 1000. */}
        <main className="pb-tabbar mx-auto flex w-full max-w-180 flex-col gap-3 px-3 pt-3 tablet:gap-4 tablet:px-6 tablet:pt-6 laptop:mx-0 laptop:max-w-none laptop:px-8 laptop:pt-0 laptop:pb-8">
          {children}
        </main>
        <TabBar />
        {menuMounted ? (
          <Suspense fallback={null}>
            <MenuSheet open={menuOpen} onOpenChange={setMenuOpen} real={!demo} />
          </Suspense>
        ) : null}
        <Toaster />
      </div>
    </CatatProvider>
  );
}
