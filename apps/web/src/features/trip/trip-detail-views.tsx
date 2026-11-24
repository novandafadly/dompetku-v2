import { formatRupiah, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { CategoryIcon } from '@/components/ui/category-icon';
import { ArchiveIcon } from '@/components/ui/icons/archive';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { InfoIcon } from '@/components/ui/icons/info';
import { WarningIcon } from '@/components/ui/icons/warning';
import { MoneyText } from '@/components/ui/money-text';
import { SpaceTag } from '@/components/ui/space-tag';
import { card, focusRing, heroCard, rowDivider, tile } from '@/components/ui/styles';
import { groupByDayVM } from '@/features/ledger/group-by-day';
import { entryMetaKindVM, entryTitleVM, signedAmountVM } from '@/features/ledger/present';
import type {
  TripBreakdownRowVM,
  TripBreakdownVM,
  TripCandidateVM,
  TripOverviewVM,
} from '@/features/ledger/trip-types';
import type { EntryVM, Ruang } from '@/features/ledger/types';
import { TRIP_COPY as C } from './copy';
import { tripBreakdownDay } from './present';
import { RangeText, TripPhaseBadge } from './trip-phase';

/**
 * Tampilan Server Component Detail trip (S15-TR5..TR10): hero, banner arsip, kartu anggaran,
 * rincian `Per kategori`/`Per hari`/`Dicatat oleh`, kartu `Masukkan`, dan daftar pengeluaran.
 * Semua angka datang dari SQL (`api.trip_overview/trip_breakdown/trip_candidates`); UI tidak
 * menjumlah, membagi, atau mengurangkan uang.
 */

const BAR_FILL: Record<Ruang, string> = { pribadi: 'bg-pribadi', bersama: 'bg-bersama' };

/** Ukuran angka besar hero agar `Rp 12.345.678.900` tidak menggeser layar 320 px (pola EntryDetailView). */
function heroAmountClass(amount: Rupiah): string | null {
  const len = formatRupiah(amount).length;
  if (len <= 11) return null;
  if (len <= 13) return 'text-amount-sm font-extrabold narrow:text-amount';
  if (len === 14) return 'text-title-lg font-extrabold narrow:text-amount-sm tablet:text-amount';
  return 'text-title font-extrabold tablet:text-amount';
}

export function TripArchivedBanner({ restore }: { restore: ReactNode }) {
  return (
    <section
      aria-label={C.archivedBannerTitle}
      className={`flex flex-wrap items-start justify-between gap-3 p-4 ${card}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <ArchiveIcon size={18} className="mt-0.5 shrink-0 text-text-soft" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-body font-bold text-text">{C.archivedBannerTitle}</p>
          <p className="text-meta font-medium text-text-soft">{C.archivedBannerBody}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{restore}</div>
    </section>
  );
}

export function TripHero({
  trip,
  ruang,
  titleId,
  editAction,
  archiveAction,
  addBudgetAction,
}: {
  trip: TripOverviewVM;
  ruang: Ruang;
  titleId: string;
  editAction?: ReactNode;
  archiveAction?: ReactNode;
  addBudgetAction?: ReactNode;
}) {
  const suffix = trip.archived
    ? undefined
    : trip.phase === 'ongoing' && trip.elapsedDays > 0
      ? C.ongoingProgress(trip.elapsedDays, trip.dayCount)
      : trip.phase === 'upcoming'
        ? C.upcomingStart(trip.startsOn)
        : undefined;
  const empty = trip.entryCount === 0 && trip.spent === 0;
  const sizeClass = empty ? null : heroAmountClass(trip.spent);

  return (
    <section aria-labelledby={titleId} className={`flex flex-col gap-3 p-4 laptop:p-5 ${heroCard}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1
          id={titleId}
          tabIndex={-1}
          className="min-w-0 flex-1 text-title font-extrabold break-words text-text outline-none"
        >
          {trip.name}
        </h1>
        <SpaceTag space={ruang} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta font-medium text-text-soft">
        <span>
          <RangeText startsOn={trip.startsOn} endsOn={trip.endsOn} />
          {` · ${C.days(trip.dayCount)}`}
        </span>
        <TripPhaseBadge phase={trip.phase} archived={trip.archived} suffix={suffix} />
      </div>
      <div className="flex flex-col gap-1 pt-1">
        <p className="text-meta font-semibold text-text-soft">{C.totalLabel}</p>
        {empty ? (
          <p className="text-body font-semibold text-text-soft" data-testid="trip-total">
            {C.noTripExpenses}
          </p>
        ) : (
          <>
            <p data-testid="trip-total">
              <MoneyText
                value={trip.spent}
                size={sizeClass === null ? 'amount' : 'inherit'}
                {...(sizeClass === null ? {} : { className: sizeClass })}
              />
            </p>
            <p className="text-meta font-medium text-text-muted">
              {C.expenseCount(trip.entryCount)}
            </p>
          </>
        )}
        {trip.perDay === null ? null : (
          <p className="text-meta font-medium text-text-soft">{C.perDay(trip.perDay)}</p>
        )}
      </div>
      {!trip.archived ? (
        <div className="flex flex-col gap-1 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            {editAction}
            {archiveAction}
          </div>
          {trip.budget === null ? addBudgetAction : null}
        </div>
      ) : null}
    </section>
  );
}

export function TripBudgetCard({ trip, ruang }: { trip: TripOverviewVM; ruang: Ruang }) {
  const headingId = useId();
  if (trip.budget === null || trip.budgetLeft === null || trip.pct === null) return null;
  const pct = trip.pct;
  const barWidth = Math.min(pct, 100);
  const pctLabel = trip.spent > 0 && pct === 0 ? C.belowOne : C.pct(pct);
  const over = trip.budgetLeft < 0;

  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-2.5 p-4 ${card}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className="text-label font-bold text-text-soft">
          {C.budgetTitle}
        </h2>
        <MoneyText value={trip.budget} size="inherit" className="text-body font-bold text-text" />
      </div>
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-labelledby={headingId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={barWidth}
          aria-valuetext={C.progressText(pct, trip.spent, trip.budget, trip.budgetLeft)}
          className="h-2 min-w-0 flex-1 overflow-hidden rounded-xs border border-hairline bg-surface-2"
        >
          <span
            className={`block h-full ${BAR_FILL[ruang]}`}
            style={{ width: `${String(barWidth)}%` }}
          />
        </div>
        <span className="num shrink-0 text-body font-bold text-text">{pctLabel}</span>
      </div>
      {trip.spent === 0 ? (
        <p className="text-meta font-medium text-text-muted">{C.noExpenses}</p>
      ) : over ? (
        <p className="flex items-center gap-1.5 text-body font-bold text-warning">
          <WarningIcon size={16} weight="fill" className="shrink-0" />
          <span>{C.over(-trip.budgetLeft)}</span>
        </p>
      ) : (
        <p className="text-body font-bold text-text">{C.remaining(trip.budgetLeft)}</p>
      )}
      <p className="text-caption font-medium text-text-muted">{C.budgetNote}</p>
    </section>
  );
}

function BreakdownList({
  rows,
  formatRow,
}: {
  rows: readonly TripBreakdownRowVM[];
  formatRow: (row: TripBreakdownRowVM) => { label: string; note?: string | undefined };
}) {
  return (
    <ul className="pb-1">
      {rows.map((r) => {
        const { label, note } = formatRow(r);
        return (
          <li
            key={r.key}
            className={`${rowDivider} flex items-start justify-between gap-3 py-2.5 max-narrow:flex-col max-narrow:gap-1`}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                title={label}
                className="line-clamp-2 text-body/tight font-semibold break-words text-text"
              >
                {label}
              </span>
              <span className="text-meta font-medium text-text-muted">
                {C.expenseCount(r.entryCount)}
              </span>
              {note === undefined ? null : (
                <span className="inline-flex items-center gap-1 text-caption font-semibold text-text-muted">
                  <InfoIcon size={14} className="shrink-0" />
                  <span>{note}</span>
                </span>
              )}
            </div>
            <MoneyText
              value={r.amount}
              size="inherit"
              className="shrink-0 text-body font-bold text-text"
            />
          </li>
        );
      })}
    </ul>
  );
}

export function TripBreakdownCard({
  trip,
  breakdown,
  memberCount,
}: {
  trip: TripOverviewVM;
  breakdown: TripBreakdownVM;
  memberCount: number;
}) {
  if (trip.entryCount === 0) return null;
  const showMember = memberCount >= 2 && breakdown.member.length > 0;
  return (
    <section aria-label="Rincian pengeluaran trip" className={`px-4 ${card}`}>
      <details open className={`group ${rowDivider}`}>
        <summary
          className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg text-label font-bold text-text-soft ${focusRing}`}
        >
          <span>{C.byCategory}</span>
          <CaretDownIcon size={16} weight="bold" className="shrink-0 group-open:rotate-180" />
        </summary>
        <BreakdownList
          rows={breakdown.category}
          formatRow={(r) => ({ label: r.label ?? C.uncategorized })}
        />
      </details>
      <details className={`group ${rowDivider}`}>
        <summary
          className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg text-label font-bold text-text-soft ${focusRing}`}
        >
          <span>{C.byDay(breakdown.day.length)}</span>
          <CaretDownIcon size={16} weight="bold" className="shrink-0 group-open:rotate-180" />
        </summary>
        <BreakdownList
          rows={breakdown.day}
          formatRow={(r) => {
            const d = tripBreakdownDay(r.key, trip.startsOn, trip.endsOn);
            return { label: d.label, note: d.outOfRange ? C.outsideDates : undefined };
          }}
        />
      </details>
      {showMember ? (
        <details open className={`group ${rowDivider}`}>
          <summary
            className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg text-label font-bold text-text-soft ${focusRing}`}
          >
            <span>{C.byMember}</span>
            <CaretDownIcon size={16} weight="bold" className="shrink-0 group-open:rotate-180" />
          </summary>
          <BreakdownList
            rows={breakdown.member}
            formatRow={(r) => ({
              label: r.isMe === true ? C.me : (r.label ?? C.otherMember),
            })}
          />
        </details>
      ) : null}
    </section>
  );
}

export function TripCandidatesCard({
  trip,
  candidates,
  candidatesMore,
  openImport,
}: {
  trip: TripOverviewVM;
  candidates: readonly TripCandidateVM[];
  candidatesMore: boolean;
  openImport: ReactNode;
}) {
  const headingId = useId();
  if (trip.archived || candidates.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-2.5 p-4 ${card}`}>
      <div className="flex items-start gap-2.5">
        <InfoIcon size={18} className="mt-0.5 shrink-0 text-text-soft" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={headingId} className="text-body font-bold text-text">
            {C.candidatesTitle}
          </h2>
          <p className="text-meta font-medium text-text-soft">
            {C.candidatesSummary(candidates.length, trip.startsOn, trip.endsOn)}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-start gap-1.5">
        {openImport}
        {candidatesMore ? (
          <p className="text-caption font-medium text-text-muted">{C.candidatesMore}</p>
        ) : null}
      </div>
    </section>
  );
}

export function TripEntriesCard({
  trip,
  entries,
  entriesTruncated,
  hasCandidates,
  today,
  headingId,
  entryHref,
  removeEntry,
}: {
  trip: TripOverviewVM;
  entries: readonly EntryVM[];
  entriesTruncated: boolean;
  hasCandidates: boolean;
  today: IsoDate;
  headingId: string;
  entryHref: (entryId: string) => Route;
  removeEntry: (entry: EntryVM, title: string) => ReactNode;
}) {
  if (entries.length === 0) {
    if (trip.archived || hasCandidates) return null;
    return <p className="text-meta font-medium text-text-soft">{C.emptyDetailHint}</p>;
  }
  const groups = groupByDayVM(entries, today);
  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-1 px-4 pt-3.5 pb-1 ${card}`}>
      <h2
        id={headingId}
        tabIndex={-1}
        className="min-h-7 text-label font-bold text-text-soft outline-none"
      >
        {C.entriesTitle}
      </h2>
      <div className="flex flex-col gap-2">
        {groups.map((g) => (
          <div key={g.date} className="flex flex-col">
            <h3 className="pt-1 pb-0.5 text-meta font-semibold text-text-soft">{g.label}</h3>
            <ul>
              {g.entries.map((entry) => {
                const title = entryTitleVM(entry);
                const { value, kind } = signedAmountVM(entry);
                const isSplit = entry.split !== undefined;
                const canRemove = !trip.archived && !isSplit;
                return (
                  <li
                    key={entry.id}
                    data-trip-entry-row={entry.id}
                    className={`${rowDivider} flex items-center gap-1`}
                  >
                    <Link
                      href={entryHref(entry.id)}
                      className={`-ml-4 flex min-h-15.5 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 hover-pointer:bg-hover active:bg-hover ${canRemove ? 'pr-2' : '-mr-4 pr-4'} ${focusRing}`}
                    >
                      <span aria-hidden="true" className={`size-10 shrink-0 ${tile}`}>
                        <CategoryIcon name={entry.categoryName} kind={entry.kind} size={20} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="flex min-w-36 flex-1 flex-col gap-0.5">
                          <span
                            title={title}
                            className="line-clamp-2 text-body/tight font-semibold break-words text-text"
                          >
                            {title}
                          </span>
                          <span className="truncate text-meta font-medium text-text-muted">
                            {`${entryMetaKindVM(entry)} · ${entry.accountName}`}
                          </span>
                          {isSplit ? (
                            <span className="inline-flex items-center gap-1 text-caption font-semibold text-text-muted">
                              <InfoIcon size={12} className="shrink-0" />
                              <span>{C.fromSplit}</span>
                            </span>
                          ) : null}
                        </span>{' '}
                        <span className="shrink-0">
                          <MoneyText value={value} kind={kind} />
                        </span>
                      </span>
                    </Link>
                    {canRemove ? (
                      <div className="-mr-2 shrink-0">{removeEntry(entry, title)}</div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {entriesTruncated ? (
        <p className="flex items-start gap-1.5 border-t border-hairline py-3 text-caption font-medium text-text-muted">
          <InfoIcon size={14} className="mt-0.5 shrink-0" />
          <span>{C.truncatedNote}</span>
        </p>
      ) : null}
    </section>
  );
}
