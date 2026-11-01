'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PlusIcon } from '@/components/ui/icons/plus';
import { focusRing } from '@/components/ui/styles';
import { useOpenCatat, usePreloadCatat } from './catat';
import { tabFromPathname } from './hrefs';
import { useNavItems } from './nav-items';
import { useNav } from './nav-provider';

const slot = `flex min-h-13 min-w-0 flex-1 flex-col items-center justify-center gap-0.75 rounded-lg text-nav ${focusRing}`;

export function TabBar() {
  const { ruang, href } = useNav();
  const active = tabFromPathname(usePathname());
  const items = useNavItems();
  const openCatat = useOpenCatat();
  const preloadCatat = usePreloadCatat();
  const catat = (
    <div key="catat" className="flex-catat flex min-w-0 items-center justify-center px-1">
      <button
        type="button"
        data-catat-trigger=""
        aria-keyshortcuts="c"
        onPointerEnter={preloadCatat}
        onFocus={preloadCatat}
        onClick={() => {
          openCatat();
        }}
        className={`flex min-w-11 items-center justify-center gap-1.5 rounded-toast text-label font-extrabold text-on-accent max-narrow:flex-col max-narrow:gap-0.75 max-narrow:text-nav max-narrow:text-text narrow:h-12 narrow:border narrow:border-accent-edge narrow:bg-accent narrow:px-3.5 narrow:hover-pointer:bg-accent-hover narrow:active:bg-accent-press ${focusRing}`}
      >
        {/* < 360 px: ubin ikon 48×48 dengan label di bawahnya. */}
        <span className="flex items-center justify-center max-narrow:size-12 max-narrow:rounded-toast max-narrow:border max-narrow:border-accent-edge max-narrow:bg-accent max-narrow:text-on-accent">
          <PlusIcon size={18} weight="bold" />
        </span>
        Catat
      </button>
    </div>
  );
  const links = items.map(({ tab, label, Icon }) => {
    const current = tab === active;
    return (
      <Link
        key={tab}
        href={href(ruang, tab)}
        aria-current={current ? 'page' : undefined}
        className={`${slot} ${current ? 'font-extrabold text-text' : 'font-medium text-text-muted hover-pointer:text-text'}`}
      >
        <Icon
          size={22}
          weight={current ? 'fill' : 'regular'}
          className={current ? 'text-accent-text' : ''}
        />
        {label}
      </Link>
    );
  });
  // Catat selalu di tengah daftar tab yang tampil.
  const mid = Math.ceil(links.length / 2);
  return (
    <nav
      aria-label="Tab utama"
      className="pb-safe fixed inset-x-0 bottom-0 z-20 flex items-stretch border-t border-hairline bg-tab px-1.5 pt-1.5 laptop:hidden"
    >
      {[...links.slice(0, mid), catat, ...links.slice(mid)]}
    </nav>
  );
}
