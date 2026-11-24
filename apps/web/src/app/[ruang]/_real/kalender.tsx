import { shortDateLabel, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';
import { ArrowLeftIcon } from '@/components/ui/icons/arrow-left';
import { CalendarDotsIcon } from '@/components/ui/icons/calendar-dots';
import { InfoIcon } from '@/components/ui/icons/info';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { ListCard } from '@/components/ui/list-card';
import { MoneyText } from '@/components/ui/money-text';
import { segmentItemDense, segmentTrack } from '@/components/ui/segment-styles';
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/ui/state';
import { card, focusRing, rowDivider } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';
import { KALENDER_COPY as C } from '@/features/rencana/kalender-copy';
import type { KalenderData, KalenderDays } from '@/features/rencana/types';
import { PageHeader } from '@/features/shell/page-header';
import { RetryIsland } from './transaksi-islands';

/**
 * Kalender arus kas mode nyata (Server Component penuh, S16-KL2..KL4): tanpa pulau JS tambahan.
 * Pemilih 30 / 60 / 90 hari memakai tautan biasa (`?hari=`). Semua nominal berasal dari
 * `api.cashflow_calendar` (SQL bigint); komponen ini hanya memformat.
 */

const WINDOWS: readonly KalenderDays[] = [30, 60, 90];
const WRAP = 'flex flex-col gap-3 tablet:gap-4 laptop:max-w-180';

function kalenderHref(ruang: Ruang, query: string, days: KalenderDays): Route {
  const p = new URLSearchParams(query);
  p.delete('hari');
  if (days !== 30) p.set('hari', String(days));
  const q = p.toString();
  return `/${ruang}/rencana/kalender${q === '' ? '' : `?${q}`}` as Route;
}

function tagihanHref(ruang: Ruang, query: string): Route {
  const p = new URLSearchParams(query);
  p.set('bagian', 'tagihan');
  return `/${ruang}/rencana?${p.toString()}` as Route;
}

function fullDate(d: IsoDate): string {
  return `${shortDateLabel(d)} ${d.slice(0, 4)}`;
}

function BalanceOrText({
  value,
  zeroText,
  danger = false,
}: {
  value: Rupiah;
  zeroText: string;
  danger?: boolean;
}) {
  if (value === 0) {
    return <span className="text-body font-bold text-text-muted">{zeroText}</span>;
  }
  return (
    <MoneyText
      value={value}
      kind="neutral"
      size="list"
      className={danger || value < 0 ? 'text-danger' : 'text-text'}
    />
  );
}

export function KalenderReal({
  ruang,
  query,
  data,
}: {
  ruang: Ruang;
  query: string;
  data: KalenderData;
}) {
  const scheduledDays = data.days.filter((d) => d.billsCount > 0);
  return (
    <>
      <PageHeader title={C.title} />
      <div className={WRAP}>
        <Link
          href={tagihanHref(ruang, query)}
          className={`inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg text-meta font-bold text-accent-text hover-pointer:underline ${focusRing}`}
        >
          <ArrowLeftIcon size={16} weight="bold" />
          {C.back}
        </Link>

        {/* HP/tablet: judul terlihat (pola Laporan/Review); h1 sr-only di PageHeader. */}
        <p aria-hidden="true" className="text-title font-extrabold text-text laptop:hidden">
          {C.title}
        </p>

        <nav aria-label={C.windowAria} className={`${segmentTrack} w-full`}>
          {WINDOWS.map((d) => (
            <Link
              key={d}
              href={kalenderHref(ruang, query, d)}
              scroll={false}
              aria-current={d === data.daysWindow ? 'page' : undefined}
              className={segmentItemDense(d === data.daysWindow)}
            >
              {C.windowLabel(d)}
            </Link>
          ))}
        </nav>

        <section
          aria-label="Ringkasan proyeksi saldo"
          className={`${card} flex flex-col gap-3 p-4`}
        >
          <div className="grid grid-cols-1 gap-3 tablet:grid-cols-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-caption font-semibold text-text-muted">{C.startBalance}</span>
              <BalanceOrText value={data.startBalance} zeroText={C.noBalance} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-caption font-semibold text-text-muted">{C.billsTotal}</span>
              {data.totalBillsCount === 0 ? (
                <span className="text-body font-bold text-text-muted">{C.noBills}</span>
              ) : (
                <>
                  <MoneyText value={data.totalBillsAmount} kind="neutral" size="list" />
                  <span className="text-caption font-medium text-text-muted">
                    {C.billsCount(data.totalBillsCount)}
                  </span>
                </>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-caption font-semibold text-text-muted">{C.lowestBalance}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <BalanceOrText
                  value={data.lowestBalance}
                  zeroText={C.zeroBalance}
                  danger={data.lowestBalance < 0}
                />
                {data.lowestBalance < 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger-tint px-2 py-0.5 text-caption font-bold text-danger">
                    <WarningCircleIcon size={14} weight="fill" />
                    {C.shortBadge}
                  </span>
                ) : null}
              </div>
              <span className="text-caption font-medium text-text-muted">
                {fullDate(data.lowestDay)}
              </span>
            </div>
          </div>

          {data.firstShortDay !== null ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-lg bg-danger-tint px-3 py-2 text-meta font-semibold text-danger"
            >
              <WarningCircleIcon size={18} weight="fill" className="mt-0.5 shrink-0" />
              <span>{C.shortStarts(fullDate(data.firstShortDay))}</span>
            </p>
          ) : null}

          <p className="flex items-start gap-2 text-caption font-medium text-text-muted">
            <InfoIcon size={16} className="mt-0.5 shrink-0" />
            <span className="text-pretty">{C.honestNote}</span>
          </p>
        </section>

        {scheduledDays.length === 0 ? (
          <EmptyState
            tone="accent"
            icon={<CalendarDotsIcon size={28} />}
            title={C.emptyTitle}
            headingLevel={2}
            description={C.emptyDescription(data.daysWindow)}
            action={
              <Link href={tagihanHref(ruang, query)} className={buttonClass('secondary')}>
                {C.emptyAction}
              </Link>
            }
          />
        ) : (
          <ListCard
            title={C.scheduleHeading(scheduledDays.length)}
            icon={<CalendarDotsIcon size={18} />}
          >
            <ul>
              {scheduledDays.map((day) => (
                <li key={day.day} className={`${rowDivider} py-3`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-label font-bold text-text">
                      {day.day === data.today
                        ? `${C.todayPrefix} · ${shortDateLabel(day.day)}`
                        : fullDate(day.day)}
                    </p>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <span className="text-caption font-medium text-text-muted">
                        {C.closingLabel}
                      </span>
                      <BalanceOrText
                        value={day.closing}
                        zeroText={C.zeroBalance}
                        danger={day.short}
                      />
                      {day.short ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger-tint px-2 py-0.5 text-caption font-bold text-danger">
                          <WarningCircleIcon size={12} weight="fill" />
                          {C.shortBadge}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <ul className="mt-2 flex flex-col gap-1.5 border-l-2 border-hairline pl-3">
                    {day.bills.map((b) => (
                      <li
                        key={`${b.billId}-${b.dueOn}`}
                        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-meta"
                      >
                        <span className="flex flex-wrap items-center gap-1.5 font-medium text-text-soft">
                          <span>{b.name}</span>
                          {b.overdue ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-danger-tint px-2 py-0.5 text-caption font-bold text-danger">
                              <WarningCircleIcon size={12} weight="fill" />
                              {C.overdueBadge(shortDateLabel(b.dueOn))}
                            </span>
                          ) : b.projected ? (
                            <span className="rounded-full border border-hairline px-2 py-0.5 text-caption font-semibold text-text-muted">
                              {C.projectedBadge}
                            </span>
                          ) : null}
                        </span>
                        <MoneyText value={-b.amount} kind="expense" size="row" />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </ListCard>
        )}
      </div>
    </>
  );
}

export function KalenderFailed() {
  return (
    <>
      <PageHeader title={C.title} />
      <div className={WRAP}>
        <ErrorState
          title={C.failedTitle}
          description={C.failedDescription}
          actions={<RetryIsland />}
        />
      </div>
    </>
  );
}

export function KalenderLoadingPage() {
  return (
    <>
      <PageHeader title={C.title} />
      <LoadingRegion label={C.loadingLabel}>
        <div className={WRAP}>
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </LoadingRegion>
    </>
  );
}
