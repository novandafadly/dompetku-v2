import type { Route } from 'next';
import { CalendarCheckIcon } from '@/components/ui/icons/calendar-check';
import { ListCard } from '@/components/ui/list-card';
import { MoneyText } from '@/components/ui/money-text';
import { rowDivider } from '@/components/ui/styles';
import type { CategorySummaryVM } from '@/features/laporan/types';
import { BudgetItemView, BudgetSubItemView } from '@/features/rencana/budget-row-view';
import { budgetedRows, budgetedSubs } from '@/features/rencana/copy';
import type { BudgetOverviewVM } from '@/features/rencana/types';
import { REVIEW_COPY } from './review-copy';

/** "Rencana vs kenyataan" (S10-RV1): induk beranggaran (urut persen terbesar, Lewat dulu) dengan rinciannya; baca saja. */
export function ReviewBudgetsView({ budgets }: { budgets: readonly BudgetOverviewVM[] }) {
  const roots = budgetedRows(budgets.filter((b) => b.parentId === null));
  const subs = budgets.filter((b) => b.parentId !== null);
  return (
    <ListCard title={REVIEW_COPY.versus} icon={<CalendarCheckIcon size={18} />}>
      <ul>
        {roots.map((row) => {
          const mine = budgetedSubs(subs, row.categoryId);
          return (
            <li key={row.categoryId} className={`${rowDivider} py-3`}>
              <BudgetItemView
                row={row}
                caret={false}
                rincian={
                  mine.length > 0 && row.subAllocated !== null
                    ? { count: mine.length, allocated: row.subAllocated }
                    : undefined
                }
              />
              {mine.length > 0 ? (
                <ul
                  aria-label={`Rincian ${row.name}`}
                  className="mt-2 ml-4 flex flex-col gap-3 border-l-2 border-hairline pl-3"
                >
                  {mine.map((sub) => (
                    <li key={sub.categoryId}>
                      <BudgetSubItemView row={sub} caret={false} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </ListCard>
  );
}

/** Induk yang punya pengeluaran tetapi tanpa anggaran periode itu (`root_total` dari SQL). */
export function ReviewUnbudgetedView({
  rows,
  link,
}: {
  rows: readonly CategorySummaryVM[];
  link?: { href: Route; label: string } | undefined;
}) {
  return (
    <ListCard title={REVIEW_COPY.unbudgeted} {...(link ? { link } : {})}>
      <ul>
        {rows.map((r) => (
          <li
            key={r.categoryId}
            className={`${rowDivider} flex min-h-12 items-center justify-between gap-3 py-2`}
          >
            <span className="min-w-0 break-words text-body/snug font-semibold text-text">
              {r.name ?? 'Tanpa nama'}
            </span>
            <MoneyText value={r.rootTotal} size="inherit" className="shrink-0 font-bold" />
          </li>
        ))}
      </ul>
    </ListCard>
  );
}
