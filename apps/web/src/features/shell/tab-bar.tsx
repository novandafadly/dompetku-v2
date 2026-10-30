'use client';

import { PlusIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { focusRing } from '@/components/ui/styles';
import { useOpenCatat } from './catat';
import { useDemo } from './demo-provider';
import { tabFromPathname } from './hrefs';
import { useNavItems } from './nav-items';

const slot = `flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 text-sm ${focusRing}`;

export function TabBar() {
  const { ruang, href } = useDemo();
  const active = tabFromPathname(usePathname());
  const items = useNavItems();
  const openCatat = useOpenCatat();
  const catat = (
    <button
      key="catat"
      type="button"
      onClick={() => {
        openCatat();
      }}
      className={`${slot} w-14 flex-none rounded-field bg-accent font-semibold text-on-accent`}
    >
      <PlusIcon size={24} weight="bold" aria-hidden="true" />
      Catat
    </button>
  );
  const links = items.map(({ tab, label, Icon }) => {
    const current = tab === active;
    return (
      <Link
        key={tab}
        href={href(ruang, tab)}
        aria-current={current ? 'page' : undefined}
        className={`${slot} flex-1 ${current ? 'font-semibold text-accent' : 'text-text-muted'}`}
      >
        <Icon size={24} weight={current ? 'fill' : 'regular'} aria-hidden="true" />
        {label}
      </Link>
    );
  });
  // Catat selalu di tengah daftar tab yang tampil.
  const mid = Math.ceil(links.length / 2);
  return (
    <nav
      aria-label="Tab utama"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      className="fixed inset-x-0 bottom-0 z-10 flex items-stretch border-t border-hairline bg-surface lg:hidden"
    >
      {[...links.slice(0, mid), catat, ...links.slice(mid)]}
    </nav>
  );
}
