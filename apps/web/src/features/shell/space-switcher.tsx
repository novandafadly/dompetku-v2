'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { focusRing } from '@/components/ui/styles';
import { useDemo } from './demo-provider';
import { RUANG_LABEL, tabFromPathname } from './hrefs';

const RUANGS = ['pribadi', 'bersama'] as const;

/** Dua tautan bergaya segmented control; ruang aktif ditandai teks tebal dan aria-current. */
export function SpaceSwitcher() {
  const { ruang, href } = useDemo();
  const tab = tabFromPathname(usePathname());
  return (
    <nav aria-label="Ruang" className="inline-flex rounded-field bg-surface-2 p-1">
      {RUANGS.map((r) => {
        const current = r === ruang;
        return (
          <Link
            key={r}
            href={href(r, tab)}
            aria-current={current ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-field px-4 text-base ${focusRing} ${
              current ? 'bg-surface font-semibold text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            {RUANG_LABEL[r]}
          </Link>
        );
      })}
    </nav>
  );
}
