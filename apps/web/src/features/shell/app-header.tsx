'use client';

import { ListIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { SpaceSwitcher } from './space-switcher';

export function AppHeader({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-hairline bg-accent-tint px-4 py-2 lg:hidden">
      <SpaceSwitcher />
      <Button variant="secondary" onClick={onMenu}>
        <ListIcon size={20} aria-hidden="true" />
        Menu
      </Button>
    </header>
  );
}
