import type { Route } from 'next';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';
import { CategoryChartView } from '@/features/laporan/category-chart-view';
import { ClassBreakdownView } from '@/features/laporan/class-breakdown-view';
import { ContributionReportView } from '@/features/laporan/contribution-report-view';
import { laporanHref } from '@/features/laporan/href';
import {
  LaporanEmptyCard,
  LaporanFailedCard,
  LaporanLoading,
} from '@/features/laporan/laporan-states';
import { PeriodPicker } from '@/features/laporan/period-picker';
import { excludedLines } from '@/features/laporan/present';
import { SummaryCardView } from '@/features/laporan/summary-card-view';
import { TrendChartView } from '@/features/laporan/trend-chart-view';
import type { Ruang } from '@/features/ledger/types';
import { PageHeader } from '@/features/shell/page-header';
import type { LaporanData } from '@/server/ledger/laporan';
import { CatatEmptyIsland } from './transaksi-islands';

/**
 * Laporan mode nyata (Server Component penuh, S9-LP1…LP13): tanpa `'use client'` dan tanpa modul
 * demo. Pemilih periode dan dasar periode adalah tautan `?periode=…&basis=…`; semua angka dari
 * `loadLaporan` (SQL). Urutan DOM = urutan baca = urutan fokus: periode → Ringkasan → Tidak
 * termasuk → Kategori → Tren → Kontribusi (Bersama). Laptop menempatkan kolom dengan grid tanpa
 * mengubah urutan DOM.
 */

const WRAP = 'flex flex-col gap-3 tablet:gap-4 laptop:max-w-250';

/** Tautan ke Rencana > Anggaran (query tema dibawa). */
function rencanaHref(ruang: Ruang, query: string): Route {
  const p = new URLSearchParams(query);
  p.set('bagian', 'anggaran');
  return `/${ruang}/rencana?${p.toString()}` as Route;
}

export function LaporanReal({
  ruang,
  query,
  data,
}: {
  ruang: Ruang;
  query: string;
  data: LaporanData;
}) {
  const { period, summary } = data;
  const title = period.label.split(' · ')[0] ?? period.label;
  const empty = data.categories.length === 0 && data.classes.length === 0;
  const viewed = period.labelMonth.slice(0, 7);
  const inTrendWindow = data.trend.some((r) => r.labelMonth.slice(0, 7) === viewed);
  const showTrend =
    inTrendWindow && data.trend.some((r) => r.pemasukan !== 0 || r.pengeluaran !== 0);
  return (
    <>
      <PageHeader title="Laporan" />
      <div className={WRAP}>
        {/* HP/tablet: judul terlihat (SPEC §3); `h1` aslinya sr-only dari PageHeader, jadi ini dekoratif. */}
        <p aria-hidden="true" className="text-title font-extrabold text-text laptop:hidden">
          Laporan
        </p>
        <PeriodPicker ruang={ruang} period={period} query={query} />
        {empty ? (
          <LaporanEmptyCard
            action={
              period.isCurrent ? (
                <CatatEmptyIsland />
              ) : (
                <Link
                  href={laporanHref(ruang, query, { periode: null, basis: period.basis })}
                  className={buttonClass('secondary')}
                >
                  Ke periode ini
                </Link>
              )
            }
          />
        ) : (
          <>
            <div className="flex flex-col gap-3 tablet:gap-4 laptop:grid laptop:grid-cols-2 laptop:items-start">
              <div className="flex flex-col gap-3 tablet:grid tablet:grid-cols-2 tablet:items-start tablet:gap-4 laptop:flex laptop:flex-col laptop:items-stretch">
                <SummaryCardView
                  ruang={ruang}
                  period={period}
                  summary={summary}
                  title={title}
                  labelledBy="lp-ringkasan"
                />
                <ClassBreakdownView
                  lines={excludedLines(data.classes, ruang)}
                  labelledBy="lp-tidak-termasuk"
                />
              </div>
              <CategoryChartView
                rows={data.categories}
                budgets={data.budgets}
                rencanaHref={period.isCurrent ? rencanaHref(ruang, query) : null}
                labelledBy="lp-kategori"
              />
            </div>
          </>
        )}
        {showTrend ? (
          <TrendChartView rows={data.trend} viewed={viewed} labelledBy="lp-tren" />
        ) : null}
        {!empty && data.contributions !== null ? (
          <div className="laptop:w-1/2 laptop:pr-2">
            <ContributionReportView vm={data.contributions} labelledBy="lp-kontribusi" />
          </div>
        ) : null}
      </div>
    </>
  );
}

/** Gagal muat (galat loader ditangkap page): `Coba lagi` = tautan ke alamat yang sama. */
export function LaporanFailed({ href }: { ruang: Ruang; href: string }) {
  return (
    <>
      <PageHeader title="Laporan" />
      <div className={WRAP}>
        <LaporanFailedCard retryHref={href} />
      </div>
    </>
  );
}

/** Memuat (`loading.tsx`). */
export function LaporanLoadingPage() {
  return (
    <>
      <PageHeader title="Laporan" />
      <div className={WRAP}>
        <LaporanLoading />
      </div>
    </>
  );
}
