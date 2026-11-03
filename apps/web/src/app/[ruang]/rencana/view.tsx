'use client';

import { buttonClass } from '@/components/ui/button';
import { CalendarCheckIcon } from '@/components/ui/icons/calendar-check';
import { HouseIcon } from '@/components/ui/icons/house';
import { EmptyState } from '@/components/ui/state';
import { useDemo } from '@/features/shell/demo-context';
import { PageHeader } from '@/features/shell/page-header';
import Link from 'next/link';

/** R1: keadaan kosong jujur; ringkasan anggaran dan tagihan tetap di Beranda. */
export function RencanaPage() {
  const { ruang, href } = useDemo();
  return (
    <>
      <PageHeader title="Rencana" />
      <div className="laptop:max-w-180">
        <EmptyState
          tone="accent"
          icon={<CalendarCheckIcon size={28} />}
          title="Rencana segera hadir"
          headingLevel={2}
          description="Anggaran dan tagihan akan diatur di sini. Untuk sekarang ringkasannya tetap tampil di Beranda."
          action={
            <Link href={href(ruang, 'beranda')} className={buttonClass('secondary')}>
              <HouseIcon size={18} />
              Ke Beranda
            </Link>
          }
        />
      </div>
    </>
  );
}
