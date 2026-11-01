'use client';

import type { ReactNode } from 'react';
import { SpaceIcon } from '@/components/ui/space-tag';
import { useNav } from './nav-provider';
import { RUANG_LABEL } from './hrefs';

const EYEBROW = { pribadi: 'text-pribadi', bersama: 'text-bersama' } as const;

/**
 * Judul halaman. Laptop: label ruang kapital + H1 28/800 + aksi kanan, selebar area isi.
 * HP/tablet: seluruh blok hanya untuk pembaca layar (header aplikasi sudah menulis ruang); aksi
 * yang perlu tampil di HP dirender halaman di isinya sendiri.
 */
export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  const { ruang } = useNav();
  return (
    <header className="sr-only laptop:not-sr-only laptop:-mx-8 laptop:mb-3 laptop:flex laptop:items-end laptop:justify-between laptop:gap-4 laptop:border-b laptop:border-hairline laptop:px-8 laptop:pt-5.5 laptop:pb-4.5">
      <div className="flex flex-col gap-1.5">
        <span
          className={`flex items-center gap-1.5 text-caption/none font-extrabold tracking-eyebrow uppercase ${EYEBROW[ruang]}`}
        >
          <SpaceIcon space={ruang} size={14} />
          Ruang {RUANG_LABEL[ruang]}
        </span>
        <h1 className="text-title-lg font-extrabold text-text">{title}</h1>
      </div>
      {action ? <div className="hidden shrink-0 laptop:block">{action}</div> : null}
    </header>
  );
}
