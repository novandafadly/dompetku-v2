import { formatRupiah } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import { CalendarCheckIcon } from '@/components/ui/icons/calendar-check';
import { CalendarDotsIcon } from '@/components/ui/icons/calendar-dots';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { InfoIcon } from '@/components/ui/icons/info';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { EmptyLine, ListCard } from '@/components/ui/list-card';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { segmentItem, segmentTrack } from '@/components/ui/segment-styles';
import { card, focusRing, rowDivider } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';
import { PageHeader } from '@/features/shell/page-header';
import {
  BudgetItemView,
  BudgetSubItemView,
  BudgetTotalCard,
  UnbudgetedItemView,
} from '@/features/rencana/budget-row-view';
import { ArchivedBillView, BillAmountColumn, BillBodyView } from '@/features/rencana/bill-row-view';
import { groupBills, rowAction, type BillItem } from '@/features/rencana/bills';
import {
  budgetedRows,
  budgetedSubs,
  candidateSubs,
  periodSubtitle,
  RENCANA_COPY,
  splitPeriodLabel,
  TAGIHAN_COPY,
  unbudgetedRows,
} from '@/features/rencana/copy';
import type { RencanaData } from '@/features/rencana/types';
import {
  AddBillIsland,
  AddSubIsland,
  BillBodyIsland,
  PayIsland,
  UnskipIsland,
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

// Lebar eksplisit: `w-full` + `-mx-4` hanya menggeser; baris harus melebar 2 × 16 px agar bilah dan
// isinya selebar garis pemisah.
const ROW =
  'flex w-[calc(100%+2rem)] items-center -mx-4 px-4 hover-pointer:bg-hover active:bg-hover ' +
  focusRing;
const BUDGET_ROW = `${ROW} min-h-19 py-3`;
const UNBUDGETED_ROW = `${ROW} min-h-15.5`;
// Rincian (S10): menjorok 16 px dengan garis kiri 2 px; selebar sisa kartu sampai tepi kanan.
const SUB_LIST = 'ml-4 border-l-2 border-hairline';
const SUB_ROW = `flex w-[calc(100%+1rem)] -mr-4 min-h-16 items-center py-2.5 pr-4 pl-3 hover-pointer:bg-hover active:bg-hover ${focusRing}`;
const ADD_SUB =
  'ml-4 flex min-h-11 items-center gap-1.5 border-l-2 border-hairline pl-3 text-meta font-bold text-accent-text hover-pointer:bg-hover active:bg-hover';
// Badan baris tagihan: ubin + nama + sub; kolom kanan (nominal + Bayar) di luar tombol.
const BILL_BODY = `flex min-h-18 min-w-0 flex-[1_1_15rem] items-center gap-3 py-2.5 pr-2 pl-4 text-left hover-pointer:bg-hover active:bg-hover ${focusRing}`;

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
      {budgeted.length > 0 || newPeriod ? (
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
          <BudgetTotalCard totals={data.totals} labelledBy="rencana-total" />
          <ListCard title={RENCANA_COPY.budgeted} icon={<CalendarCheckIcon size={18} />}>
            <ul>
              {budgeted.map((row) => {
                const subs = budgetedSubs(data.subBudgets, row.categoryId);
                const candidates = candidateSubs(data.subBudgets, row.categoryId);
                return (
                  <li key={row.categoryId} className={rowDivider}>
                    <BudgetRowIsland categoryId={row.categoryId} className={BUDGET_ROW}>
                      <BudgetItemView
                        row={row}
                        rincian={
                          subs.length > 0 && row.subAllocated !== null
                            ? { count: subs.length, allocated: row.subAllocated }
                            : undefined
                        }
                      />
                    </BudgetRowIsland>
                    {subs.length > 0 ? (
                      <ul aria-label={RENCANA_COPY.subListLabel(row.name)} className={SUB_LIST}>
                        {subs.map((sub) => (
                          <li key={sub.categoryId}>
                            <BudgetRowIsland categoryId={sub.categoryId} className={SUB_ROW}>
                              <BudgetSubItemView row={sub} />
                            </BudgetRowIsland>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {candidates.length > 0 ? (
                      <AddSubIsland
                        parentId={row.categoryId}
                        parentName={row.name}
                        className={ADD_SUB}
                      />
                    ) : null}
                  </li>
                );
              })}
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
      {budgeted.length > 0 && unbudgeted.length > 0 ? (
        // Laptop: aksi yang sama ada di header halaman (satu tombol bernama sama per layar).
        <SetBudgetIsland
          label={RENCANA_COPY.set}
          variant="secondary"
          plus
          className="w-full laptop:hidden"
        />
      ) : null}
    </>
  );
}

function BillRowItem({ item }: { item: BillItem }) {
  const { occ, bill } = item;
  const action = rowAction(occ);
  const amount = occ?.amount ?? bill.amount;
  return (
    <li className={rowDivider}>
      <div className="-mx-4 flex flex-wrap items-start">
        <BillBodyIsland billId={bill.billId} occurrenceId={occ?.occurrenceId} className={BILL_BODY}>
          <BillBodyView item={item} caret />
        </BillBodyIsland>
        <BillAmountColumn amount={occ?.skipped === true ? null : amount}>
          {occ !== null && action === 'bayar' ? (
            <PayIsland
              occurrenceId={occ.occurrenceId}
              billName={bill.name}
              amountText={formatRupiah(occ.amount)}
            />
          ) : null}
          {occ !== null && action === 'batalkan' ? (
            <UnskipIsland occurrenceId={occ.occurrenceId} billName={bill.name} />
          ) : null}
        </BillAmountColumn>
      </div>
    </li>
  );
}

function BillGroup({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: BillItem[];
}) {
  if (items.length === 0) return null;
  return (
    <ListCard title={title} icon={icon}>
      <ul>
        {items.map((item) => (
          <BillRowItem key={item.occ?.occurrenceId ?? item.bill.billId} item={item} />
        ))}
      </ul>
    </ListCard>
  );
}

function Tagihan({ data }: { data: RencanaData }) {
  const g = groupBills(data);
  const active = g.overdue.length + g.period.length + g.next.length;
  return (
    <>
      {active === 0 ? (
        <EmptyState
          tone="accent"
          icon={<CalendarCheckIcon size={28} />}
          title={RENCANA_COPY.emptyBillTitle}
          headingLevel={2}
          description={RENCANA_COPY.emptyBillDescription}
          action={<AddBillIsland label={TAGIHAN_COPY.add} variant="primary" />}
        />
      ) : null}
      <BillGroup
        title={TAGIHAN_COPY.overdue}
        icon={<WarningCircleIcon size={18} weight="fill" className="text-danger" />}
        items={g.overdue}
      />
      <BillGroup
        title={TAGIHAN_COPY.thisPeriod}
        icon={<CalendarDotsIcon size={18} />}
        items={g.period}
      />
      <BillGroup title={TAGIHAN_COPY.next} icon={<CalendarDotsIcon size={18} />} items={g.next} />
      {active > 0 ? (
        <AddBillIsland
          label={TAGIHAN_COPY.add}
          variant="secondary"
          plus
          className="w-full laptop:hidden"
        />
      ) : null}
      {g.archived.length > 0 ? (
        <details className={`group ${card} px-4`}>
          <summary
            className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg text-label font-bold text-text-soft ${focusRing}`}
          >
            {TAGIHAN_COPY.archived(g.archived.length)}
            <CaretDownIcon size={16} weight="bold" className="shrink-0 group-open:rotate-180" />
          </summary>
          <ul className="pb-1">
            {g.archived.map((bill) => (
              <li key={bill.billId} className={rowDivider}>
                <ArchivedBillView bill={bill} />
              </li>
            ))}
          </ul>
        </details>
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
  const wajibRoots: Record<string, true> = {};
  for (const b of data.budgets) if (b.budget !== null && b.wajib) wajibRoots[b.categoryId] = true;
  return (
    <RencanaHostIsland
      ruang={ruang}
      month={data.period.labelMonth.slice(0, 7)}
      range={splitPeriodLabel(data.period.label).range}
      rows={data.budgets}
      subRows={data.subBudgets}
      previous={data.previous.amounts}
      billNameByRoot={billNameByRoot}
      bill={{
        bills: data.bills,
        occurrences: [...data.due, ...data.upcoming],
        accounts: data.accounts,
        categories: data.categories,
        today: data.today,
        wajibRoots,
      }}
    >
      <PageHeader
        title="Rencana"
        action={
          bagian === 'anggaran' && hasBudgets && unbudgetedRows(data.budgets).length > 0 ? (
            <SetBudgetIsland label={RENCANA_COPY.set} variant="secondary" plus />
          ) : bagian === 'tagihan' && hasBills ? (
            <AddBillIsland label={TAGIHAN_COPY.add} variant="secondary" plus />
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
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <SetBudgetIsland label={RENCANA_COPY.setFirst} variant="primary" />
                <AddBillIsland label={TAGIHAN_COPY.add} variant="secondary" />
              </div>
            }
          />
        ) : bagian === 'anggaran' ? (
          <Anggaran data={data} />
        ) : (
          <Tagihan data={data} />
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
