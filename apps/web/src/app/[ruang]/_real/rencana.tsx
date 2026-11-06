import type { Route } from 'next';
import Link from 'next/link';
import { CalendarCheckIcon } from '@/components/ui/icons/calendar-check';
import { InfoIcon } from '@/components/ui/icons/info';
import { EmptyLine, ListCard } from '@/components/ui/list-card';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { focusRing, rowDivider, segmentItem, segmentTrack } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';
import { PageHeader } from '@/features/shell/page-header';
import {
  BudgetItemView,
  BudgetTotalCard,
  UnbudgetedItemView,
} from '@/features/rencana/budget-row-view';
import {
  budgetedRows,
  periodSubtitle,
  RENCANA_COPY,
  splitPeriodLabel,
  unbudgetedRows,
} from '@/features/rencana/copy';
import type { RencanaData } from '@/features/rencana/types';
import {
  BudgetRowIsland,
  CopyBudgetsIsland,
  CopyConflictIsland,
  RencanaHostIsland,
  SetBudgetIsland,
} from './rencana-islands';
import { RetryIsland } from './transaksi-islands';

/**
 * Rencana mode nyata (Server Component; S9-RC0, S9-AN1). Satu halaman, dua bagian lewat
 * `?bagian=anggaran|tagihan` (segmen tautan, tanpa JS). Daftar dan kartu total dirender di server
 * dari `budget_overview`; hanya tombol pembuka sheet yang pulau klien (dimuat malas). Bagian
 * Tagihan menyusul (Task 11): sementara hanya keadaan kosong tanpa aksi.
 */

export type Bagian = 'anggaran' | 'tagihan';

const ROW =
  'flex w-full items-center -mx-4 px-4 hover-pointer:bg-hover active:bg-hover ' + focusRing;
const BUDGET_ROW = `${ROW} min-h-19 py-3`;
const UNBUDGETED_ROW = `${ROW} min-h-15.5`;

function bagianHref(ruang: Ruang, bagian: Bagian, query: string): Route {
  const params = new URLSearchParams(query);
  if (bagian === 'tagihan') params.set('bagian', 'tagihan');
  else params.delete('bagian');
  const q = params.toString();
  return `/${ruang}/rencana${q === '' ? '' : `?${q}`}` as Route;
}

function Segmen({ ruang, bagian, query }: { ruang: Ruang; bagian: Bagian; query: string }) {
  const items: { b: Bagian; label: string }[] = [
    { b: 'anggaran', label: 'Anggaran' },
    { b: 'tagihan', label: 'Tagihan' },
  ];
  return (
    <nav aria-label="Bagian Rencana" className={`${segmentTrack} w-full`}>
      {items.map(({ b, label }) => (
        <Link
          key={b}
          href={bagianHref(ruang, b, query)}
          scroll={false}
          aria-current={b === bagian ? 'page' : undefined}
          className={segmentItem(b === bagian)}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

function Anggaran({ data }: { data: RencanaData }) {
  const budgeted = budgetedRows(data.budgets);
  const unbudgeted = unbudgetedRows(data.budgets);
  const { title } = splitPeriodLabel(data.period.label);
  const newPeriod = budgeted.length === 0 && data.previous.budgetCount > 0;
  return (
    <>
      {budgeted.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <h2 className="text-header font-extrabold text-text">{title}</h2>
          <p className="text-meta font-medium text-text-muted">{periodSubtitle(data.period)}</p>
        </div>
      ) : null}
      {newPeriod ? (
        <section
          aria-label="Anggaran periode lalu"
          className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface p-4"
        >
          <p className="flex items-start gap-2 text-label font-medium text-text-soft">
            <InfoIcon size={18} className="mt-px shrink-0" />
            <span className="text-pretty">
              {RENCANA_COPY.newPeriod(data.previous.budgetCount)}
              {data.previous.wajibCount > 0 ? ` ${RENCANA_COPY.newPeriodWajib}` : ''}
            </span>
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <CopyBudgetsIsland />
            <SetBudgetIsland label={RENCANA_COPY.set} variant="secondary" />
          </div>
        </section>
      ) : null}
      <CopyConflictIsland />
      {budgeted.length === 0 && !newPeriod ? (
        <EmptyState
          tone="accent"
          icon={<CalendarCheckIcon size={28} />}
          title={RENCANA_COPY.emptyBudgetTitle}
          headingLevel={2}
          description={RENCANA_COPY.emptyBudgetDescription}
          action={<SetBudgetIsland label={RENCANA_COPY.setFirst} variant="primary" />}
        />
      ) : null}
      {budgeted.length > 0 ? (
        <>
          <BudgetTotalCard rows={budgeted} labelledBy="rencana-total" />
          <ListCard title={RENCANA_COPY.budgeted} icon={<CalendarCheckIcon size={18} />}>
            <ul>
              {budgeted.map((row) => (
                <li key={row.categoryId} className={rowDivider}>
                  <BudgetRowIsland categoryId={row.categoryId} className={BUDGET_ROW}>
                    <BudgetItemView row={row} />
                  </BudgetRowIsland>
                </li>
              ))}
            </ul>
          </ListCard>
        </>
      ) : null}
      {unbudgeted.length > 0 ? (
        <ListCard title={RENCANA_COPY.unbudgeted}>
          <ul>
            {unbudgeted.map((row) => (
              <li key={row.categoryId} className={rowDivider}>
                <BudgetRowIsland categoryId={row.categoryId} className={UNBUDGETED_ROW}>
                  <UnbudgetedItemView row={row} />
                </BudgetRowIsland>
              </li>
            ))}
          </ul>
        </ListCard>
      ) : budgeted.length > 0 ? (
        <ListCard title={RENCANA_COPY.unbudgeted}>
          <EmptyLine>{RENCANA_COPY.allBudgeted}</EmptyLine>
        </ListCard>
      ) : null}
      {budgeted.length > 0 ? (
        <SetBudgetIsland label={RENCANA_COPY.set} variant="secondary" plus className="w-full" />
      ) : null}
    </>
  );
}

export function RencanaReal({
  ruang,
  bagian,
  query,
  data,
}: {
  ruang: Ruang;
  bagian: Bagian;
  /** Query yang dibawa tautan (mode nyata: hanya `theme`), '' atau '?a=b'. */
  query: string;
  data: RencanaData;
}) {
  const hasBudgets = data.budgets.some((b) => b.budget !== null);
  const hasBills = data.bills.some((b) => !b.archived);
  const empty = !hasBudgets && !hasBills && data.previous.budgetCount === 0;
  const billNameByRoot: Record<string, string> = {};
  for (const b of data.bills) if (!b.archived) billNameByRoot[b.rootCategoryId] = b.name;
  return (
    <RencanaHostIsland
      ruang={ruang}
      month={data.period.labelMonth.slice(0, 7)}
      range={splitPeriodLabel(data.period.label).range}
      rows={data.budgets}
      previous={data.previous.amounts}
      billNameByRoot={billNameByRoot}
    >
      <PageHeader
        title="Rencana"
        action={
          bagian === 'anggaran' && hasBudgets ? (
            <SetBudgetIsland label={RENCANA_COPY.set} variant="secondary" plus />
          ) : undefined
        }
      />
      <div className="flex flex-col gap-3 laptop:max-w-180">
        <Segmen ruang={ruang} bagian={bagian} query={query} />
        {empty ? (
          <EmptyState
            tone="accent"
            icon={<CalendarCheckIcon size={28} />}
            title={RENCANA_COPY.emptyTitle(ruang)}
            headingLevel={2}
            description={RENCANA_COPY.emptyDescription}
            action={<SetBudgetIsland label={RENCANA_COPY.setFirst} variant="primary" />}
          />
        ) : bagian === 'anggaran' ? (
          <Anggaran data={data} />
        ) : (
          <EmptyState
            tone="accent"
            icon={<CalendarCheckIcon size={28} />}
            title={RENCANA_COPY.emptyBillTitle}
            headingLevel={2}
            description={RENCANA_COPY.emptyBillDescription}
          />
        )}
      </div>
    </RencanaHostIsland>
  );
}

/** Gagal muat (galat loader ditangkap page): salinan tetap + Coba lagi (`router.refresh`). */
export function RencanaFailed() {
  return (
    <>
      <PageHeader title="Rencana" />
      <div className="laptop:max-w-180">
        <ErrorState
          title={RENCANA_COPY.failedTitle}
          description={RENCANA_COPY.failedDescription}
          actions={<RetryIsland />}
        />
      </div>
    </>
  );
}
