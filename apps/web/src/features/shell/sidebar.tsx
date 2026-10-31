'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DotsThreeCircleIcon } from '@/components/ui/icons/dots-three-circle';
import { PlusIcon } from '@/components/ui/icons/plus';
import { focusRing } from '@/components/ui/styles';
import { DemoMark } from './app-header';
import { useOpenCatat, usePreloadCatat } from './catat';
import { useDemo } from './demo-provider';
import { tabFromPathname } from './hrefs';
import { useNavItems } from './nav-items';
import { SpaceSwitcher } from './space-switcher';

const row = `flex h-11 w-full items-center gap-3 rounded-lg px-3 text-label ${focusRing}`;
const idle = 'font-semibold text-text-soft hover-pointer:bg-hover hover-pointer:text-text';

/** Merek "Dompet" + "Ku" berwarna aksen; teks, bukan logo (logo belum diputuskan pemilik). */
export function Wordmark({ className = 'text-headline' }: { className?: string }) {
  return (
    <span className={`font-extrabold tracking-tight text-text ${className}`}>
      Dompet<span className="text-accent-text">Ku</span>
    </span>
  );
}

export function Sidebar({ onMenu }: { onMenu: () => void }) {
  const { ruang, href } = useDemo();
  const active = tabFromPathname(usePathname());
  const items = useNavItems();
  const openCatat = useOpenCatat();
  const preloadCatat = usePreloadCatat();
  return (
    <aside
      aria-label="Sidebar"
      className="fixed inset-y-0 left-0 z-20 hidden w-62 flex-col gap-4 border-r border-hairline bg-tab px-4 py-5 laptop:flex"
    >
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <Wordmark />
        <DemoMark />
      </div>
      <SpaceSwitcher wide />
      <Button
        data-catat-trigger=""
        aria-keyshortcuts="c"
        className="w-full justify-start"
        onPointerEnter={preloadCatat}
        onFocus={preloadCatat}
        onClick={() => {
          openCatat();
        }}
      >
        <PlusIcon size={18} weight="bold" />
        Catat
        <kbd
          aria-hidden="true"
          className="ml-auto rounded-sm border border-current px-1.5 py-0.75 font-mono text-tag font-bold"
        >
          C
        </kbd>
      </Button>
      <nav aria-label="Navigasi utama" className="flex flex-col gap-0.5">
        {items.map(({ tab, label, Icon }) => {
          const current = tab === active;
          return (
            <Link
              key={tab}
              href={href(ruang, tab)}
              aria-current={current ? 'page' : undefined}
              className={`${row} ${current ? 'bg-surface-2 font-extrabold text-text shadow-rail' : idle}`}
            >
              <Icon
                size={20}
                weight={current ? 'fill' : 'regular'}
                className={current ? 'text-accent-text' : ''}
              />
              {label}
            </Link>
          );
        })}
        <button type="button" onClick={onMenu} className={`${row} ${idle}`}>
          <DotsThreeCircleIcon size={20} />
          Menu
        </button>
      </nav>
    </aside>
  );
}
