import type { Route } from 'next';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';
import { LoadingRegion, Skeleton, EmptyState, ErrorState } from '@/components/ui/state';
import { ChartBarIcon } from '@/components/ui/icons/chart-bar';
import { PeriodPicker } from '@/features/laporan/period-picker';
import { SummaryCardView } from '@/features/laporan/summary-card-view';
import type { Ruang } from '@/features/ledger/types';
import { BudgetTotalCard } from '@/features/rencana/budget-row-view';
import { bulanTahunLabel } from '@/features/laporan/present';
import { REVIEW_COPY } from './review-copy';
import { ReviewBudgetsView, ReviewUnbudgetedView } from './review-views';
import { PageHeader } from '@/features/shell/page-header';
import type { ReviewData } from '@/server/ledger/review';
import { RetryIsland } from './transaksi-islands';
import { ReviewCopyIsland } from './review-islands';

/**
 * Review bulanan mode nyata (Server Component; S10-RV1/RV2): periode (hanya dasar gajian) →
 * Ringkasan (angka Laporan) → Rencana vs kenyataan → Tanpa anggaran → Siapkan {Bulan berikutnya}.
 * Semua angka dari `loadReview` (SQL, fungsi yang sama dengan Laporan dan Rencana).
 */
const WRAP = 'flex flex-col gap-3 tablet:gap-4 laptop:max-w-250';

function reviewHref(ruang: Ruang, query: string, periode: string | null): Route {
  const p = new URLSearchParams(query);
  p.delete('periode');
  if (periode) p.set('periode', periode);
  const q = p.toString();
  return `/${ruang}/rencana/review${q === '' ? '' : `?${q}`}` as Route;
}

function rencanaHref(ruang: Ruang, query: string): Route {
  const p = new URLSearchParams(query);
  p.set('bagian', 'anggaran');
  return `/${ruang}/rencana?${p.toString()}` as Route;
}

export function ReviewReal({
  ruang,
  query,
  data,
}: {
  ruang: Ruang;
  query: string;
  data: ReviewData;
}) {
  const { period, summary } = data;
  const title = period.label.split(' · ')[0] ?? period.label;
  const hasBudgets = data.budgets.some((b) => b.budget !== null);
  const empty =
    !hasBudgets &&
    data.unbudgeted.length === 0 &&
    summary.pengeluaran === 0 &&
    summary.pemasukan === 0;
  return (
    <>
      <PageHeader title={REVIEW_COPY.title(title)} />
      <div className={WRAP}>
        {/* HP/tablet: judul terlihat (pola Laporan); `h1` aslinya sr-only dari PageHeader, jadi ini dekoratif. */}
        <p aria-hidden="true" className="text-title font-extrabold text-text laptop:hidden">
          {REVIEW_COPY.link}
        </p>
        <PeriodPicker
          ruang={ruang}
          period={period}
          query={query}
          showBasis={false}
          hrefFor={({ periode }) => reviewHref(ruang, query, periode)}
        />
        {empty ? (
          <EmptyState
            tone="accent"
            icon={<ChartBarIcon size={28} />}
            title={REVIEW_COPY.emptyTitle}
            headingLevel={2}
            action={
              <Link href={rencanaHref(ruang, query)} className={buttonClass('secondary')}>
                {REVIEW_COPY.toRencana}
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-3 tablet:gap-4 laptop:grid laptop:grid-cols-2 laptop:items-start">
            <div className="flex flex-col gap-3 tablet:gap-4">
              <SummaryCardView
                ruang={ruang}
                period={period}
                summary={summary}
                title={title}
                labelledBy="rv-ringkasan"
              />
              {hasBudgets ? <BudgetTotalCard totals={data.totals} labelledBy="rv-total" /> : null}
            </div>
            <div className="flex flex-col gap-3 tablet:gap-4">
              {hasBudgets ? (
                <ReviewBudgetsView budgets={data.budgets} />
              ) : (
                <section
                  aria-label={REVIEW_COPY.noBudgetTitle}
                  className="flex flex-col items-start gap-3 rounded-xl border border-hairline bg-surface p-4"
                >
                  <p className="text-label font-medium text-text-soft">
                    {REVIEW_COPY.noBudgetTitle}
                  </p>
                  <Link href={rencanaHref(ruang, query)} className={buttonClass('secondary')}>
                    {REVIEW_COPY.toRencana}
                  </Link>
                </section>
              )}
              {data.unbudgeted.length > 0 ? (
                <ReviewUnbudgetedView
                  rows={data.unbudgeted}
                  link={
                    period.isCurrent
                      ? { href: rencanaHref(ruang, query), label: REVIEW_COPY.setInRencana }
                      : undefined
                  }
                />
              ) : null}
            </div>
          </div>
        )}
        {data.copy !== null ? (
          <ReviewCopyIsland
            ruang={ruang}
            toMonth={data.copy.toMonth}
            fromTitle={title}
            toTitle={bulanTahunLabel(data.copy.toMonth)}
            count={data.copy.count}
          />
        ) : null}
      </div>
    </>
  );
}

/** Gagal muat (galat loader ditangkap page): `Coba lagi` = refresh. */
export function ReviewFailed() {
  return (
    <>
      <PageHeader title={REVIEW_COPY.link} />
      <div className={WRAP}>
        <ErrorState
          title={REVIEW_COPY.failedTitle}
          description={REVIEW_COPY.failedDescription}
          actions={<RetryIsland />}
        />
      </div>
    </>
  );
}

/** Memuat (`loading.tsx`). */
export function ReviewLoadingPage() {
  return (
    <>
      <PageHeader title={REVIEW_COPY.link} />
      <div className={WRAP}>
        <LoadingRegion label={REVIEW_COPY.loading}>
          <Skeleton className="h-20" />
          <Skeleton className="h-44" />
          <Skeleton className="h-60" />
        </LoadingRegion>
      </div>
    </>
  );
}
