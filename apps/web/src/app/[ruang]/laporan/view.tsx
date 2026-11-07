'use client';

import { buttonClass } from '@/components/ui/button';
import { ChartBarIcon } from '@/components/ui/icons/chart-bar';
import { HouseIcon } from '@/components/ui/icons/house';
import { EmptyState } from '@/components/ui/state';
import { useDemo } from '@/features/shell/demo-context';
import { PageHeader } from '@/features/shell/page-header';
import Link from 'next/link';

/** Prototipe: Laporan belum punya data demo; keadaan jujur, tanpa angka (sama pola Rencana R1). */
export function LaporanPage() {
  const { ruang, href } = useDemo();
  return (
    <>
      <PageHeader title="Laporan" />
      <div className="laptop:max-w-180">
        <EmptyState
          tone="accent"
          icon={<ChartBarIcon size={28} />}
          title="Laporan segera hadir"
          headingLevel={2}
          description="Ringkasan dan grafik per periode akan tampil di sini setelah akun tersambung."
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
