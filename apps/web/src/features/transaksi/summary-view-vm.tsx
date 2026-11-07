import { formatRupiah, monthYearLabel, type Rupiah } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { focusRing } from '@/components/ui/styles';
import { ChartBarIcon } from '@/components/ui/icons/chart-bar';
import { InfoIcon } from '@/components/ui/icons/info';
import { ListCard } from '@/components/ui/list-card';
import { MoneyText } from '@/components/ui/money-text';
import type { MonthSummaryVM } from '@/features/ledger/types';

const row = 'border-t border-hairline first:border-t-0';
const cell = 'h-13 text-body';

/**
 * Ringkasan bulan dari `MonthSummaryVM`, untuk kedua mode. `kantor` hanya diisi prototipe
 * (`MonthSummaryVM` nyata belum membawanya). `children` = kartu tambahan di bawahnya (anggaran
 * prototipe; mode nyata belum merender anggaran, S9).
 */
export function SummaryViewVM({
  month,
  summary: s,
  kantor,
  laporanHref,
  children,
}: {
  month: string;
  summary: MonthSummaryVM;
  kantor?: Rupiah;
  /** Mode nyata: tautan `Laporan lengkap` (bulan kalender yang sama). */
  laporanHref?: Route;
  children?: ReactNode;
}) {
  const excluded = [
    kantor === undefined ? null : `Kas kantor ${formatRupiah(kantor)}`,
    `Transfer antar dompet ${formatRupiah(s.transfer)}`,
  ]
    .filter((t) => t !== null)
    .join(', ');
  return (
    <div className="flex flex-col gap-3 tablet:gap-4">
      <ListCard title={monthYearLabel(month)} icon={<ChartBarIcon size={18} />} className="pb-4">
        <table className="w-full border-collapse">
          <caption className="sr-only">Ringkasan bulan</caption>
          <tbody>
            <tr className={row}>
              <th scope="row" className={`${cell} text-left font-medium text-text-soft`}>
                Pemasukan
              </th>
              <td className={`${cell} text-right`}>
                <MoneyText value={s.pemasukan} />
              </td>
            </tr>
            <tr className={row}>
              <th scope="row" className={`${cell} text-left font-medium text-text-soft`}>
                Pengeluaran
              </th>
              <td className={`${cell} text-right`}>
                <MoneyText value={s.pengeluaran} />
              </td>
            </tr>
            <tr className={row}>
              <th scope="row" className={`${cell} text-left font-extrabold text-text`}>
                Selisih
              </th>
              <td className={`${cell} text-right`}>
                <MoneyText
                  value={s.selisih}
                  size="inherit"
                  className="text-headline font-extrabold"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-surface-2 px-3.5 py-3 text-label font-medium text-text-soft">
          <InfoIcon size={18} className="mt-px shrink-0" />
          <span>{`Tidak termasuk: ${excluded}`}</span>
        </p>
        {laporanHref ? (
          <Link
            href={laporanHref}
            className={`mt-1 flex min-h-11 items-center justify-between gap-2 rounded-lg text-label font-bold text-accent-text ${focusRing}`}
          >
            Laporan lengkap
            <CaretRightIcon size={16} weight="bold" />
          </Link>
        ) : null}
      </ListCard>
      {children}
    </div>
  );
}
