'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Ruang } from '@dompetku/demo-data';
import { DemoBanner } from '@/components/ui/demo-banner';
import { AppHeader } from './app-header';
import { CatatProvider } from './catat';
import { MenuSheet } from './menu-sheet';
import { Sidebar } from './sidebar';
import { TabBar } from './tab-bar';

export function AppShell({ ruang, children }: { ruang: Ruang; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.ruang = ruang;
  }, [ruang]);
  return (
    <CatatProvider>
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
      </div>
    </CatatProvider>
  );
}
