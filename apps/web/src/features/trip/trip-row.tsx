import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AirplaneTiltIcon } from '@/components/ui/icons/airplane-tilt';
import { ArchiveIcon } from '@/components/ui/icons/archive';
import { WarningIcon } from '@/components/ui/icons/warning';
import { MoneyText } from '@/components/ui/money-text';
import { rowDivider, rowLink, tile } from '@/components/ui/styles';
import type { TripVM } from '@/features/ledger/trip-types';
import { TRIP_COPY as C } from './copy';
import { RangeText } from './trip-phase';

/**
 * Baris daftar Trip (S15-TR3): seluruh baris = satu tautan ≥ 72 px. Tanpa bilah anggaran di
 * daftar (bilah hanya di Detail); tanpa `Rp 0`; di bawah 360 px nominal turun ke baris kedua rata
 * kiri di bawah meta agar `Rp 12.345.678.900` tidak memampatkan nama trip.
 */

function BudgetLine({ trip }: { trip: TripVM }) {
  if (trip.budget === null || trip.spent === 0 || trip.budgetLeft === null) return null;
  if (trip.budgetLeft < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-meta font-semibold whitespace-nowrap text-warning">
        <WarningIcon size={14} weight="fill" className="shrink-0" />
        <span>{C.over(-trip.budgetLeft)}</span>
      </span>
    );
  }
  return (
    <span className="text-meta font-semibold whitespace-nowrap text-text-soft">
      {C.remaining(trip.budgetLeft)}
    </span>
  );
}

function TripRight({ trip }: { trip: TripVM }) {
  if (trip.entryCount === 0 && trip.spent === 0) {
    return (
      <span className="text-meta font-medium text-text-muted max-narrow:col-start-2 max-narrow:justify-self-start">
        {C.noExpenses}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5 text-right max-narrow:col-start-2 max-narrow:items-start max-narrow:text-left">
      <MoneyText value={trip.spent} size="inherit" className="text-body font-bold text-text" />
      <span className="text-meta font-medium whitespace-nowrap text-text-muted">
        {C.expenseCount(trip.entryCount)}
      </span>
      <BudgetLine trip={trip} />
    </span>
  );
}

export function TripRow({ trip, href }: { trip: TripVM; href: Route }) {
  return (
    <li className={rowDivider}>
      <Link
        href={href}
        data-trip-row={trip.id}
        className={`${rowLink} min-h-18 py-3 max-narrow:grid max-narrow:grid-cols-tile-text max-narrow:items-start max-narrow:gap-y-1`}
      >
        <span aria-hidden="true" className={`size-10 ${tile} max-narrow:row-span-2`}>
          <AirplaneTiltIcon size={20} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            title={trip.name}
            className="line-clamp-2 text-body/tight font-semibold break-words text-text"
          >
            {trip.name}
          </span>
          <span className="text-meta font-medium text-text-muted">
            <RangeText startsOn={trip.startsOn} endsOn={trip.endsOn} />
            {` · ${C.days(trip.dayCount)}`}
          </span>
        </span>{' '}
        <TripRight trip={trip} />
      </Link>
    </li>
  );
}

/**
 * Baris di `Trip diarsipkan` (S15-TR3): ikon ubin `archive`, fase `Diarsipkan` di meta, dan tombol
 * `Pulihkan` (slot) di baris sendiri rata kanan DI LUAR tautan (tidak ada tombol di dalam tautan).
 */
export function ArchivedTripRow({
  trip,
  href,
  restore,
}: {
  trip: TripVM;
  href: Route;
  restore: ReactNode;
}) {
  return (
    <li className={rowDivider}>
      <div className="flex flex-col pb-2.5">
        <Link
          href={href}
          data-trip-row={trip.id}
          className={`${rowLink} min-h-18 py-3 max-narrow:grid max-narrow:grid-cols-tile-text max-narrow:items-start max-narrow:gap-y-1`}
        >
          <span aria-hidden="true" className={`size-10 ${tile} max-narrow:row-span-2`}>
            <ArchiveIcon size={20} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span
              title={trip.name}
              className="line-clamp-2 text-body/tight font-semibold break-words text-text"
            >
              {trip.name}
            </span>
            <span className="text-meta font-medium text-text-muted">
              <RangeText startsOn={trip.startsOn} endsOn={trip.endsOn} />
              {` · ${C.days(trip.dayCount)} · ${C.phaseArchived}`}
            </span>
          </span>{' '}
          <TripRight trip={trip} />
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">{restore}</div>
      </div>
    </li>
  );
}
