'use client';

import { ListIcon, PlusIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { focusRing } from '@/components/ui/styles';
import { useOpenCatat, usePreloadCatat } from './catat';
import { useDemo } from './demo-provider';
import { tabFromPathname } from './hrefs';
import { useNavItems } from './nav-items';
import { SpaceSwitcher } from './space-switcher';

const row = `flex min-h-11 w-full items-center gap-3 rounded-field px-3 text-base ${focusRing}`;

export function Sidebar({ onMenu }: { onMenu: () => void }) {
  const { ruang, href } = useDemo();
  const active = tabFromPathname(usePathname());
  const items = useNavItems();
  const openCatat = useOpenCatat();
  const preloadCatat = usePreloadCatat();
  return (
    <aside
      aria-label="Sidebar"
      className="fixed inset-y-0 left-0 hidden w-62 flex-col gap-4 border-r border-hairline bg-surface p-4 lg:flex"
    >
      <p className="px-1 text-xl font-bold text-text">DompetKu</p>
      <SpaceSwitcher />
      <Button
        data-catat-trigger=""
        className="min-h-12"
        onPointerEnter={preloadCatat}
        onFocus={preloadCatat}
        onClick={() => {
          openCatat();
        }}
      >
        <PlusIcon size={20} weight="bold" aria-hidden="true" />
        Catat
      </Button>
      <nav aria-label="Navigasi utama" className="flex flex-col gap-1">
        {items.map(({ tab, label, Icon }) => {
          const current = tab === active;
          return (
            <Link
              key={tab}
              href={href(ruang, tab)}
              aria-current={current ? 'page' : undefined}
              className={`${row} ${current ? 'bg-surface-2 font-semibold text-accent' : 'text-text-muted hover:bg-surface-2 hover:text-text'}`}
            >
              <Icon size={20} weight={current ? 'fill' : 'regular'} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onMenu}
          className={`${row} text-text-muted hover:bg-surface-2 hover:text-text`}
        >
          <ListIcon size={20} aria-hidden="true" />
          Menu
        </button>
      </nav>
    </aside>
  );
}
