'use client';

import { budgetProgress, groupByDay, monthSummary } from '@dompetku/demo-data';
import type { DemoState, Entry } from '@dompetku/demo-data';
import { addMonths, monthName, monthYearLabel } from '@dompetku/domain';
import { useRouter } from 'next/navigation';
import { lazy, Suspense, useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ArrowDownIcon } from '@/components/ui/icons/arrow-down';
import { CaretLeftIcon } from '@/components/ui/icons/caret-left';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { FunnelXIcon } from '@/components/ui/icons/funnel-x';
import { ListBulletsIcon } from '@/components/ui/icons/list-bullets';
import { XIcon } from '@/components/ui/icons/x';
import { EmptyState, Skeleton } from '@/components/ui/state';
import { card } from '@/components/ui/styles';
import type { DayGroupVM } from '@/features/ledger/group-by-day';
import { RUANG_NAME, type TransaksiContext } from './context';
import { entryToVM } from './demo-vm';
import { EntryListView, SampahLink } from './entry-list-view';
import {
  FilterChips,
  filterLabel,
  filtersFor,
  matchesFilter,
  matchesSearch,
  SearchField,
  type FilterId,
} from './filters';
import { TransaksiLayout } from './transaksi-layout';

const PAGE = 50;

/**
 * Ringkasan demo dimuat malas: di HP hanya tampil setelah segmen Ringkasan diketuk, di laptop
 * menyusul sesudah hidrasi (tata letak laptop memang baru dipilih sesudah hidrasi). Batas JS
 * muat dingin rute prototipe (ADR 0002, 162 kB).
 */
const SummaryView = lazy(() => import('./summary-view').then((m) => ({ default: m.SummaryView })));

function earliestMonth(state: DemoState, ruang: TransaksiContext['ruang'], fallback: string) {
  let min = fallback;
  for (const e of state.entries) {
    if (e.ruang === ruang && e.occurredOn.slice(0, 7) < min) min = e.occurredOn.slice(0, 7);
  }
  return min;
}

function MonthNav({
  month,
  canPrev,
  canNext,
  onShift,
}: {
  month: string;
  canPrev: boolean;
  canNext: boolean;
  onShift: (delta: number) => void;
}) {
  return (
    <div role="group" aria-label="Bulan" className="flex items-center justify-between gap-2">
      <IconButton
        label="Bulan sebelumnya"
        icon={<CaretLeftIcon size={18} weight="bold" />}
        disabled={!canPrev}
        onClick={() => {
          onShift(-1);
        }}
      />
      <p
        aria-live="polite"
        className="text-body font-extrabold text-text laptop:min-w-40 laptop:text-center"
      >
        {monthYearLabel(month)}
      </p>
      <IconButton
        label="Bulan berikutnya"
        icon={<CaretRightIcon size={18} weight="bold" />}
        disabled={!canNext}
        onClick={() => {
          onShift(1);
        }}
      />
    </div>
  );
}

/** T4: teks memuat yang terlihat + kerangka baris. */
function ListLoading({ month }: { month: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="px-1 text-label font-semibold text-text-muted">
        {`Memuat transaksi ${monthName(month)}…`}
      </p>
      {[3, 2].map((rows, g) => (
        <div key={g} aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton className="mx-1 h-3.5 w-24" />
          <div className={`flex flex-col gap-4 px-4 py-3 ${card}`}>
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-lg" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-3.5 w-16" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DayGroups({
  ctx,
  entries,
  limit,
}: {
  ctx: TransaksiContext;
  entries: Entry[];
  limit: number;
}) {
  const baseId = useId();
  let left = limit;
  const groups: DayGroupVM[] = [];
  for (const g of groupByDay(entries, ctx.today)) {
    if (left <= 0) break;
    groups.push({
      date: g.date,
      label: g.label,
      total: g.net,
      entries: g.items.slice(0, left).map((e) => entryToVM(ctx.state, e)),
    });
    left -= g.items.length;
  }
  const reimbursable = new Set(
    entries.filter((e) => e.kind === 'expense' && e.reimbursable === true).map((e) => e.id),
  );
  return (
    <EntryListView
      groups={groups}
      idBase={baseId}
      hrefFor={ctx.entryHref}
      reimburse={(id) => reimbursable.has(id)}
    />
  );
}

export function EntryList({ header, ...ctx }: TransaksiContext & { header: ReactNode }) {
  const { state, ruang, today } = ctx;
  const currentMonth = today.slice(0, 7);
  const router = useRouter();
  const { month } = ctx;
  const [chosen, setFilter] = useState<FilterId>('semua');
  // Filter yang tidak ada di ruang ini (mis. Kantor setelah pindah ke Bersama) kembali ke Semua.
  const filter = filtersFor(ruang).some((f) => f.id === chosen) ? chosen : 'semua';
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const mine = state.entries.filter((e) => e.ruang === ruang && e.voidedAt === undefined);
  const inMonth = mine.filter((e) => e.occurredOn.startsWith(month));
  const matched = inMonth.filter(
    (e) => matchesFilter(state, e, filter) && matchesSearch(state, e, query),
  );
  const filtered = filter !== 'semua' || query.trim() !== '';
  const minMonth = earliestMonth(state, ruang, currentMonth);

  function shift(delta: number) {
    setLimit(PAGE);
    router.replace(ctx.monthHref(addMonths(month, delta)), { scroll: false });
  }

  function reset() {
    setFilter('semua');
    setQuery('');
    setLimit(PAGE);
  }

  let empty: { title: string; description?: string } | null = null;
  if (matched.length === 0) {
    const q = query.trim();
    const what = [filter === 'semua' ? '' : filterLabel(filter), q === '' ? '' : `"${q}"`]
      .filter((s) => s !== '')
      .join(' ');
    empty = filtered
      ? { title: `Tidak ada transaksi ${what} di ${monthName(month)}.` }
      : mine.length === 0
        ? {
            title: `Belum ada transaksi di ${RUANG_NAME[ruang]}.`,
            description: 'Catat transaksi pertama dengan tombol Catat.',
          }
        : { title: `Belum ada transaksi di ${monthName(month)}.` };
  }

  const list =
    ctx.dataState === 'loading' ? (
      <ListLoading month={month} />
    ) : empty ? (
      <EmptyState
        icon={filtered ? <FunnelXIcon size={26} /> : <ListBulletsIcon size={26} />}
        title={empty.title}
        {...(empty.description === undefined ? {} : { description: empty.description })}
        action={
          filtered ? (
            <Button variant="secondary" onClick={reset}>
              <XIcon size={18} weight="bold" />
              Hapus filter
            </Button>
          ) : undefined
        }
      />
    ) : (
      <>
        <DayGroups ctx={ctx} entries={matched} limit={limit} />
        {matched.length > limit ? (
          <Button
            variant="secondary"
            className="w-full laptop:w-auto laptop:self-start"
            onClick={() => {
              setLimit((l) => l + PAGE);
            }}
          >
            <ArrowDownIcon size={18} weight="bold" />
            Muat lagi
          </Button>
        ) : null}
      </>
    );

  const nav = (
    <MonthNav
      month={month}
      canPrev={month > minMonth}
      canNext={month < currentMonth}
      onShift={shift}
    />
  );

  const listBlock = (
    <div className="flex flex-col gap-3 tablet:gap-4">
      <div className="flex flex-col gap-3 laptop:flex-row laptop:items-center laptop:gap-4">
        {nav}
        <div className="laptop:flex-1">
          <SearchField
            query={query}
            onQuery={(q) => {
              setQuery(q);
              setLimit(PAGE);
            }}
          />
        </div>
      </div>
      <FilterChips
        ruang={ruang}
        filter={filter}
        onFilter={(f) => {
          setFilter(f);
          setLimit(PAGE);
        }}
      />
      {list}
      {ctx.sampahHref === undefined ? null : <SampahLink href={ctx.sampahHref} />}
    </div>
  );

  return (
    <TransaksiLayout
      header={header}
      nav={nav}
      list={listBlock}
      summary={
        <Suspense fallback={<Skeleton className="h-60" />}>
          <SummaryView
            month={month}
            summary={monthSummary(state, ruang, month)}
            budgets={budgetProgress(state, ruang, `${month}-01`)}
          />
        </Suspense>
      }
    />
  );
}
