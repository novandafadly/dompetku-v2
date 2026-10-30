'use client';

import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { groupByDay } from '@dompetku/demo-data';
import type { DemoState, Entry } from '@dompetku/demo-data';
import { addMonths, monthName } from '@dompetku/domain';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { MoneyText } from '@/components/ui/money-text';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { EmptyState } from '@/components/ui/state';
import { RUANG_NAME, type TransaksiContext } from './context';
import { EntryRow } from './entry-row';
import {
  FilterBar,
  filterLabel,
  filtersFor,
  matchesFilter,
  matchesSearch,
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
    <div role="group" aria-label="Bulan" className="mt-4 flex items-center justify-between">
      <IconButton
        label="Bulan sebelumnya"
        icon={<CaretLeftIcon size={24} />}
        disabled={!canPrev}
        onClick={() => {
          onShift(-1);
        }}
      />
      <p aria-live="polite" className="text-lg font-semibold text-text">
        {`${monthName(month)} ${month.slice(0, 4)}`}
      </p>
      <IconButton
        label="Bulan berikutnya"
        icon={<CaretRightIcon size={24} />}
        disabled={!canNext}
        onClick={() => {
          onShift(1);
        }}
      />
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
        <section key={g.date} aria-labelledby={`${baseId}-${g.date}`} className="mt-6">
          <h3
            id={`${baseId}-${g.date}`}
            className="flex items-baseline justify-between gap-3 border-b border-text pb-1 text-base font-semibold text-text"
          >
            <span>{g.label}</span>
            <MoneyText value={g.net} />
          </h3>
          <ul aria-label={`Transaksi ${g.label}`}>
            {g.shown.map((e) => (
              <EntryRow key={e.id} state={ctx.state} entry={e} href={ctx.entryHref(e.id)} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function EntryList(ctx: TransaksiContext) {
  const { state, ruang, today } = ctx;
  const currentMonth = today.slice(0, 7);
  const [view, setView] = useState<'daftar' | 'ringkasan'>('daftar');
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

  return (
    <div>
      <h1 className="sr-only">Transaksi</h1>
      <SegmentedControl
        label="Tampilan"
        items={[
          { value: 'daftar', label: 'Daftar' },
          { value: 'ringkasan', label: 'Ringkasan' },
        ]}
        value={view}
        onChange={(v) => {
          setView(v === 'ringkasan' ? 'ringkasan' : 'daftar');
        }}
      />
      <MonthNav
        month={month}
        canPrev={month > minMonth}
        canNext={month < currentMonth}
        onShift={shift}
      />
      {view === 'ringkasan' ? (
        <SummaryView state={state} ruang={ruang} month={month} />
      ) : (
        <>
          <FilterBar
            ruang={ruang}
            filter={filter}
            onFilter={(f) => {
              setFilter(f);
              setLimit(PAGE);
            }}
            query={query}
            onQuery={(q) => {
              setQuery(q);
              setLimit(PAGE);
            }}
          />
          {empty ? (
            <div className="mt-6">
              <EmptyState
                title={empty.title}
                {...(empty.description === undefined ? {} : { description: empty.description })}
                action={
                  filtered ? (
                    <Button variant="secondary" onClick={reset}>
                      Hapus filter
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <h2 className="sr-only">Daftar transaksi</h2>
              <DayGroups ctx={ctx} entries={matched} limit={limit} />
              {matched.length > limit ? (
                <div className="mt-6 flex justify-center">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setLimit((l) => l + PAGE);
                    }}
                  >
                    Muat lagi
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
