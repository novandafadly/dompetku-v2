'use client';

import { ListIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { SpaceSwitcher } from './space-switcher';

export function AppHeader({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-hairline bg-bg px-4 py-2 lg:hidden">
      <SpaceSwitcher />
      <Button variant="ghost" onClick={onMenu} className="px-3">
        <ListIcon size={20} aria-hidden="true" className="shrink-0" />
        Menu
      </Button>
    </header>
  );
}
