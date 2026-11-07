import Link from 'next/link';
import { CategoryGlyph } from '@/components/ui/category-icon';
import { ArrowsLeftRightIcon } from '@/components/ui/icons/arrows-left-right';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { TagIcon } from '@/components/ui/icons/tag';
import { WarningIcon } from '@/components/ui/icons/warning';
import { WarningOctagonIcon } from '@/components/ui/icons/warning-octagon';
import { MoneyText } from '@/components/ui/money-text';
import { card, focusRing } from '@/components/ui/styles';
import { formatRupiah } from '@dompetku/domain';
import type { ReactNode } from 'react';
import type { Route } from 'next';
import {
  barPct,
  budgetStatus,
  categoryName,
  groupCategories,
  pctText,
  type CategoryGroup,
} from './present';
import type { BudgetProgressVM, CategorySummaryVM } from './types';

const SUMMARY =
  'flex min-h-11 w-full cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden ' +
  focusRing;

function Tile({ row }: { row: CategorySummaryVM }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-soft"
    >
      {row.kind === 'fee' ? (
        <ArrowsLeftRightIcon size={22} />
      ) : row.kind === 'uncategorized' ? (
        <TagIcon size={22} />
      ) : (
        <CategoryGlyph icon={row.icon ?? ''} name={row.name ?? undefined} size={22} />
      )}
    </span>
  );
}

/** Bilah proporsi (dekoratif; persen dan nominal ada sebagai teks). Panjang = permil SQL. */
function Bar({ p10, thin = false }: { p10: number; thin?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`block w-full overflow-hidden rounded-sm bg-surface-2 ${thin ? 'h-1.5' : 'h-2'}`}
    >
      <span
        className="block h-full min-w-0.5 rounded-sm bg-chart-expense"
        style={{ width: `${String(barPct(p10))}%` }}
      />
    </span>
  );
}

function BudgetStatusText({ budget }: { budget: BudgetProgressVM }): ReactNode {
  const level = budgetStatus(budget);
  if (level === 'over') {
    return (
      <>
        <WarningOctagonIcon size={16} weight="fill" />
        <span>
          Lewat <MoneyText value={-budget.remaining} size="inherit" />
        </span>
      </>
    );
  }
  if (level === 'full') {
    return (
      <>
        <WarningOctagonIcon size={16} weight="fill" />
        <span>Terpakai penuh</span>
      </>
    );
  }
  return (
    <>
      {level === 'near' ? <WarningIcon size={16} weight="fill" /> : null}
      <span className="num">{`${String(budget.pct)}% terpakai`}</span>
    </>
  );
}

const STATUS_TONE = {
  ok: 'text-text-muted',
  near: 'text-warning',
  full: 'text-warning',
  over: 'text-danger',
} as const;

/**
 * Baris anggaran di bawah baris kategori (di luar `summary`: tautan di dalamnya melanggar
 * `nested-interactive`). Mulai 80% teks + ikon menjadi tautan 44 px ke Rencana, hanya di periode
 * berjalan (Rencana S9 menampilkan periode berjalan saja); periode lengkap = teks.
 */
function BudgetLine({
  name,
  budget,
  rencanaHref,
}: {
  name: string;
  budget: BudgetProgressVM;
  rencanaHref: Route | null;
}) {
  const level = budgetStatus(budget);
  const status = `flex items-center gap-1 font-bold ${STATUS_TONE[level]}`;
  const linked = rencanaHref !== null && level !== 'ok';
  const spoken =
    level === 'over'
      ? `Lewat ${formatRupiah(-budget.remaining)}`
      : level === 'full'
        ? 'Terpakai penuh'
        : `${String(budget.pct)}% terpakai`;
  return (
    <p className="flex flex-wrap items-center gap-x-1 pb-2 pl-13 text-meta font-medium text-text-muted">
      <span>
        dari anggaran <MoneyText value={budget.amount} size="inherit" />
        {' · '}
      </span>
      {linked ? (
        <Link
          href={rencanaHref}
          aria-label={`${name}: dari anggaran ${formatRupiah(budget.amount)}, ${spoken}. Buka di Rencana.`}
          className={`-my-1 inline-flex min-h-11 items-center ${status} ${focusRing}`}
        >
          <BudgetStatusText budget={budget} />
        </Link>
      ) : (
        <span className={status}>
          <BudgetStatusText budget={budget} />
        </span>
      )}
    </p>
  );
}

function RowBody({
  row,
  total,
  pct10,
  metaSuffix,
  income,
}: {
  row: CategorySummaryVM;
  total: number;
  pct10: number;
  metaSuffix: string;
  income: boolean;
}) {
  return (
    <>
      <Tile row={row} />
      <span className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 grow shrink basis-32">
          <span className="block text-body font-semibold break-words text-text">
            {categoryName(row)}
          </span>
          {income ? null : (
            <span className="block text-meta font-medium text-text-muted">
              {`${pctText(pct10)} ${metaSuffix}`}
            </span>
          )}
        </span>
        <MoneyText
          value={total}
          kind={income ? 'income' : 'neutral'}
          className="ml-auto whitespace-nowrap"
        />
      </span>
    </>
  );
}

function ChildRow({
  name,
  row,
  parent,
  income,
}: {
  name: string;
  row: CategorySummaryVM;
  parent: string;
  income: boolean;
}) {
  return (
    <li className="flex flex-col gap-1.5 border-t border-hairline py-2 first:border-t-0">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 grow shrink basis-32">
          <span className="block text-label font-semibold break-words text-text">{name}</span>
          {income || row.pct10InRoot === null ? null : (
            <span className="block text-caption font-medium text-text-muted">
              {`${pctText(row.pct10InRoot)} dari ${parent}`}
            </span>
          )}
        </span>
        <MoneyText
          value={row.amount}
          kind={income ? 'income' : 'neutral'}
          size="inherit"
          className="ml-auto text-label font-bold whitespace-nowrap"
        />
      </span>
      {income || row.pct10InRoot === null ? null : <Bar p10={row.pct10InRoot} thin />}
    </li>
  );
}

function GroupRow({
  group,
  budget,
  rencanaHref,
  income,
}: {
  group: CategoryGroup;
  budget: BudgetProgressVM | undefined;
  rencanaHref: Route | null;
  income: boolean;
}) {
  const { root, children } = group;
  const rootName = categoryName(root);
  const body = (
    <RowBody
      row={root}
      total={root.rootTotal}
      pct10={root.rootPct10}
      metaSuffix={income ? 'dari pemasukan' : 'dari pengeluaran'}
      income={income}
    />
  );
  const bar = income ? null : (
    <div className="pb-2 pl-13">
      <Bar p10={root.rootPct10} />
    </div>
  );
  return (
    <li className="border-t border-hairline first:border-t-0" data-testid="laporan-kategori">
      {children.length > 0 ? (
        <details className="group">
          <summary className={`${SUMMARY} pt-2.5`}>
            {body}
            <CaretDownIcon size={16} className="shrink-0 text-text-muted group-open:rotate-180" />
          </summary>
          {bar}
          <ul className="pb-1 pl-13">
            {root.amount > 0 ? (
              <ChildRow
                name={`${rootName} (langsung)`}
                row={root}
                parent={rootName}
                income={income}
              />
            ) : null}
            {children.map((c) => (
              <ChildRow
                key={c.categoryId ?? c.name ?? ''}
                name={categoryName(c)}
                row={c}
                parent={rootName}
                income={income}
              />
            ))}
          </ul>
        </details>
      ) : (
        <>
          <div className="flex min-h-11 w-full items-center gap-3 pt-2.5">{body}</div>
          {bar}
        </>
      )}
      {budget ? <BudgetLine name={rootName} budget={budget} rencanaHref={rencanaHref} /> : null}
    </li>
  );
}

/**
 * Pengeluaran per kategori + Pemasukan per kategori (S9-LP1, LP3): batang proporsi `chart-expense`
 * (panjang = `pct10` SQL), induk dengan anak dalam `details` (tanpa JS), status anggaran dari
 * `budget_progress` (basis gajian saja; `budgets` null = disembunyikan). Penyebut persen =
 * Pengeluaran penuh (termasuk biaya dan tanpa kategori).
 */
export function CategoryChartView({
  rows,
  budgets,
  rencanaHref,
  labelledBy,
}: {
  rows: readonly CategorySummaryVM[];
  budgets: readonly BudgetProgressVM[] | null;
  /** Tautan `Buka di Rencana` (hanya periode berjalan); `null` = status sebagai teks. */
  rencanaHref: Route | null;
  labelledBy: string;
}) {
  const expense = groupCategories(rows, 'expense');
  const income = groupCategories(rows, 'income');
  const budgetOf = new Map((budgets ?? []).map((b) => [b.categoryId, b]));
  return (
    <section
      aria-labelledby={labelledBy}
      data-testid="laporan-kategori-kartu"
      className={`flex flex-col px-4 py-3.5 ${card}`}
    >
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2 id={labelledBy} className="text-label font-bold text-text-soft">
          Pengeluaran per kategori
        </h2>
        {expense.groups.length > 0 ? (
          <MoneyText value={expense.total} size="inherit" className="text-label font-bold" />
        ) : null}
      </div>
      {expense.groups.length > 0 ? (
        <ul>
          {expense.groups.map((g) => (
            <GroupRow
              key={g.root.rootCategoryId ?? g.root.kind}
              group={g}
              budget={
                g.root.kind === 'category' && g.root.rootCategoryId !== null
                  ? budgetOf.get(g.root.rootCategoryId)
                  : undefined
              }
              rencanaHref={rencanaHref}
              income={false}
            />
          ))}
        </ul>
      ) : (
        <p className="py-3 text-label font-medium text-text-muted">
          Belum ada pengeluaran di periode ini.
        </p>
      )}
      {income.groups.length > 0 ? (
        <div className="mt-2 border-t border-hairline pt-3">
          <div className="flex min-h-7 items-center justify-between gap-2">
            <h3 className="text-label font-bold text-text-soft">Pemasukan per kategori</h3>
            <MoneyText
              value={income.total}
              kind="income"
              size="inherit"
              className="text-label font-bold"
            />
          </div>
          <ul>
            {income.groups.map((g) => (
              <GroupRow
                key={g.root.rootCategoryId ?? g.root.kind}
                group={g}
                budget={undefined}
                rencanaHref={null}
                income
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
