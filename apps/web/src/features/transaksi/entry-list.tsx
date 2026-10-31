'use client';

import { groupByDay } from '@dompetku/demo-data';
import type { DemoState, Entry } from '@dompetku/demo-data';
import { addMonths, monthName, monthYearLabel } from '@dompetku/domain';
import { useRouter } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ArrowDownIcon } from '@/components/ui/icons/arrow-down';
import { CaretLeftIcon } from '@/components/ui/icons/caret-left';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { FunnelXIcon } from '@/components/ui/icons/funnel-x';
import { ListBulletsIcon } from '@/components/ui/icons/list-bullets';
import { XIcon } from '@/components/ui/icons/x';
import { MoneyText } from '@/components/ui/money-text';
import { Tabs } from '@/components/ui/segmented-control';
import { useMedia } from '@/components/ui/use-media';
import { EmptyState, Skeleton } from '@/components/ui/state';
import { card } from '@/components/ui/styles';
import { RUANG_NAME, type TransaksiContext } from './context';
import { EntryRow } from './entry-row';
import {
  FilterChips,
  filterLabel,
  filtersFor,
  matchesFilter,
  matchesSearch,
  SearchField,
  type FilterId,
} from './filters';
import { SummaryView } from './summary-view';

const PAGE = 50;

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
  const groups = [];
  for (const g of groupByDay(entries, ctx.today)) {
    if (left <= 0) break;
    groups.push({ ...g, shown: g.items.slice(0, left) });
    left -= g.items.length;
  }
  return (
    <>
      {groups.map((g) => (
        <section
          key={g.date}
          aria-labelledby={`${baseId}-${g.date}`}
          className="flex flex-col gap-2"
        >
          <h3
            id={`${baseId}-${g.date}`}
            className="flex items-baseline justify-between gap-3 px-1 text-meta font-bold text-text-soft"
          >
            <span>{g.label}</span>
            <MoneyText value={g.net} size="inherit" />
          </h3>
          <ul aria-label={`Transaksi ${g.label}`} className={`px-4 ${card}`}>
            {g.shown.map((e) => (
              <EntryRow key={e.id} state={ctx.state} entry={e} href={ctx.entryHref(e.id)} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function EntryList({ header, ...ctx }: TransaksiContext & { header: ReactNode }) {
  const { state, ruang, today } = ctx;
  const currentMonth = today.slice(0, 7);
  const [view, setView] = useState<'daftar' | 'ringkasan'>('daftar');
  const router = useRouter();
  const tabsId = useId();
  // Laptop: daftar + kolom ringkasan berdampingan, tanpa segmen. Hanya satu yang dirender.
  const laptop = useMedia('(min-width: 1024px)');
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
        <h2 className="sr-only">Daftar transaksi</h2>
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
  const summary = <SummaryView state={state} ruang={ruang} month={month} />;

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
    </div>
  );

  if (laptop) {
    return (
      <>
        {header}
        <div className="grid max-w-250 grid-cols-transaksi items-start gap-5">
          <div className="min-w-0">{listBlock}</div>
          <aside aria-label="Ringkasan bulan">{summary}</aside>
        </div>
      </>
    );
  }

  // HP/tablet: segmen Daftar | Ringkasan.
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
            listBlock
          )}
        </div>
      </div>
    </>
  );
}
