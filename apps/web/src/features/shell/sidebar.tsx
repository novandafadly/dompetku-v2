'use client';

import { ListIcon, PlusIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { focusRing } from '@/components/ui/styles';
import { useOpenCatat } from './catat';
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
  return (
    <aside
      aria-label="Sidebar"
      className="fixed inset-y-0 left-0 hidden w-62 flex-col gap-4 border-r border-hairline bg-accent-tint p-4 lg:flex"
    >
      <p className="font-hero text-xl font-semibold text-text">DompetKu</p>
      <SpaceSwitcher />
      <Button
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
              className={`${row} ${current ? 'bg-surface font-semibold text-accent' : 'text-text hover:bg-surface'}`}
            >
              <Icon size={20} weight={current ? 'fill' : 'regular'} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
        <button type="button" onClick={onMenu} className={`${row} text-text hover:bg-surface`}>
          <ListIcon size={20} aria-hidden="true" />
          Menu
        </button>
      </nav>
    </aside>
  );
}
