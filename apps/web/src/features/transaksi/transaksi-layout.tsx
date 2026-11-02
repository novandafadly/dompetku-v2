'use client';

import { useId, useState, type ReactNode } from 'react';
import { Tabs } from '@/components/ui/segmented-control';
import { useMedia } from '@/components/ui/use-media';

/**
 * Tata letak Transaksi untuk kedua mode. Laptop: daftar + kolom ringkasan berdampingan, tanpa
 * segmen. HP/tablet: segmen Daftar | Ringkasan; navigasi bulan tampil di kedua panel. Isi
 * (`list`, `summary`, `nav`) dirangkai pemanggil: klien di prototipe, server di mode nyata.
 */
export function TransaksiLayout({
  header,
  nav,
  list,
  summary,
}: {
  header: ReactNode;
  nav: ReactNode;
  list: ReactNode;
  summary: ReactNode;
}) {
  const [view, setView] = useState<'daftar' | 'ringkasan'>('daftar');
  const tabsId = useId();
  // Hanya satu tata letak yang dirender.
  const laptop = useMedia('(min-width: 1024px)');

  if (laptop) {
    return (
      <>
        {header}
        <div className="grid max-w-250 grid-cols-transaksi items-start gap-5">
          <div className="min-w-0">{list}</div>
          <aside aria-label="Ringkasan bulan">{summary}</aside>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="flex flex-col gap-3 tablet:gap-4">
        <Tabs
          label="Tampilan"
          idBase={tabsId}
          items={[
            { value: 'daftar', label: 'Daftar' },
            { value: 'ringkasan', label: 'Ringkasan' },
          ]}
          value={view}
          onChange={(v) => {
            setView(v === 'ringkasan' ? 'ringkasan' : 'daftar');
          }}
        />
        <div
          id={`${tabsId}-panel`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-${view}`}
          className="flex flex-col gap-3 tablet:gap-4"
        >
          {view === 'ringkasan' ? (
            <>
              {nav}
              {summary}
            </>
          ) : (
            list
          )}
        </div>
      </div>
    </>
  );
}
