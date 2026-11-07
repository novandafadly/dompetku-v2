'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CheckIcon } from '@/components/ui/icons/check';
import { focusRing } from '@/components/ui/styles';
import { buildSectionHref, RUANG_LABEL, sectionFromPathname, tabFromPathname } from './hrefs';
import { useNav } from './nav-provider';

const RUANGS = ['pribadi', 'bersama'] as const;

const ACTIVE = {
  pribadi: 'bg-pribadi-fill font-bold text-on-pribadi',
  bersama: 'bg-bersama-fill font-bold text-on-bersama',
} as const;

/** Dua tautan dalam pil; ruang aktif = isi warna ruang + ✓ + aria-current, tidak hanya warna. */
export function SpaceSwitcher({ wide = false }: { wide?: boolean }) {
  const { ruang, href, query, sampahHref, kategoriHref } = useNav();
  const pathname = usePathname();
  const tab = tabFromPathname(pathname);
  const section = sectionFromPathname(pathname);
  // Pindah ruang dari Sampah/Kategori tetap di layar itu (bukan jatuh ke Beranda).
  const target = (r: (typeof RUANGS)[number]) =>
    section === 'sampah'
      ? sampahHref(r)
      : section === 'kategori'
        ? kategoriHref(r)
        : section === 'laporan'
          ? buildSectionHref(r, 'laporan', query)
          : href(r, tab ?? 'beranda');
  return (
    <nav
      aria-label="Ruang"
      className={`flex shrink-0 gap-0.5 rounded-full border border-border bg-surface p-0.5 ${wide ? 'w-full' : ''}`}
    >
      {RUANGS.map((r) => {
        const current = r === ruang;
        return (
          <Link
            key={r}
            href={target(r)}
            aria-current={current ? 'page' : undefined}
            className={`flex h-11 items-center justify-center gap-1.5 rounded-full px-3 text-label ${wide ? 'flex-1' : ''} ${focusRing} ${
              current ? ACTIVE[r] : 'font-semibold text-text-soft hover-pointer:bg-hover'
            }`}
          >
            {current ? <CheckIcon size={14} weight="bold" className="shrink-0" /> : null}
            {RUANG_LABEL[r]}
          </Link>
        );
      })}
    </nav>
  );
}
