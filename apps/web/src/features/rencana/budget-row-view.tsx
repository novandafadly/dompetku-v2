import { CategoryGlyph } from '@/components/ui/category-icon';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { WarningIcon } from '@/components/ui/icons/warning';
import { WarningOctagonIcon } from '@/components/ui/icons/warning-octagon';
import { MoneyText } from '@/components/ui/money-text';
import { budgetLevel, RENCANA_COPY, type BudgetLevel } from './copy';
import type { BudgetOverviewVM, BudgetTotalsVM } from './types';

/**
 * Tampilan baris dan kartu total Anggaran (S9-AN1). Server Component, tanpa `'use client'`: tombol
 * pembuka sheet dipasang pulau klien di sekelilingnya (`rencana-islands`), jadi isi di sini tidak
 * punya penangan dan tidak membawa JS. `BudgetRow` prototipe tidak dipakai/diubah (anggaran JS).
 */

const TONE: Record<BudgetLevel, string> = {
  ok: 'text-text-soft',
  near: 'text-warning',
  full: 'text-danger',
  over: 'text-danger',
};
const BAR: Record<BudgetLevel, string> = {
  ok: 'bg-chart-aman',
  near: 'bg-warning',
  full: 'bg-danger',
  over: 'bg-danger',
};

function Bar({ level, pct }: { level: BudgetLevel; pct: number }) {
  return (
    <span aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-sm bg-surface-2">
      <span
        className={`block h-full ${BAR[level]}`}
        style={{ width: `${String(Math.min(Math.max(pct, 0), 100))}%` }}
      />
    </span>
  );
}

/** Status = ikon + teks (tidak warna saja); `Lewat Rp …` menyebut nominal lewatnya. */
function Status({ level, pct, over }: { level: BudgetLevel; pct: number; over: number }) {
  return (
    <span className={`flex shrink-0 items-center gap-1 text-meta/none font-bold ${TONE[level]}`}>
      {level === 'over' || level === 'full' ? (
        <WarningOctagonIcon size={16} weight="fill" />
      ) : level === 'near' ? (
        <WarningIcon size={16} weight="fill" />
      ) : null}
      {level === 'over' ? (
        <span>
          Lewat <MoneyText value={over} size="inherit" />
        </span>
      ) : level === 'full' ? (
        <span>Terpakai penuh</span>
      ) : (
        <span className="num">{`${String(pct)}% terpakai`}</span>
      )}
    </span>
  );
}

/**
 * Isi satu baris anggaran (nama + `Wajib`, status, bilah 6 px, sub). Judul `flex-wrap`: status yang
 * panjang (`Lewat Rp 12.345.678.900`) turun ke baris kedua rata kiri, nama tidak jatuh ke nol.
 */
export function BudgetItemView({ row }: { row: BudgetOverviewVM }) {
  const budget = row.budget ?? 0;
  const level = budgetLevel(row);
  const pct = row.pct ?? 0;
  const remaining = row.remaining ?? 0;
  return (
    <span className="flex w-full flex-col gap-2 text-left">
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex min-w-0 items-center gap-2 text-body/tight font-semibold text-text">
          <span className="truncate">{row.name}</span>
          {row.wajib ? (
            <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-tag/snug font-semibold text-text-soft">
              {RENCANA_COPY.wajib}
            </span>
          ) : null}
          <CaretRightIcon size={16} className="shrink-0 text-text-muted" />
        </span>
        <Status level={level} pct={pct} over={-remaining} />
      </span>
      <Bar level={level} pct={pct} />
      <span className="text-meta font-medium text-text-muted">
        <MoneyText value={row.spent} size="inherit" /> dari{' '}
        <MoneyText value={budget} size="inherit" />
        {level === 'over' ? null : (
          <>
            {' · sisa '}
            <MoneyText value={remaining} size="inherit" />
          </>
        )}
      </span>
    </span>
  );
}

/** Isi satu baris `Belum dianggarkan`: ikon kategori, nama, terpakai periode ini, `Atur` + caret. */
export function UnbudgetedItemView({ row }: { row: BudgetOverviewVM }) {
  return (
    <span className="flex w-full items-center gap-3 text-left">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-soft">
        <CategoryGlyph icon={row.icon} name={row.name} size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.75">
        <span className="truncate text-body/tight font-semibold text-text">{row.name}</span>
        <span className="text-meta font-medium text-text-muted">
          {row.spent === 0 ? (
            RENCANA_COPY.noSpend
          ) : (
            <>
              <MoneyText value={row.spent} size="inherit" /> periode ini
            </>
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-meta font-bold text-accent-text">
        Atur
        <span className="sr-only"> anggaran {row.name}</span>
        <CaretRightIcon size={16} weight="bold" />
      </span>
    </span>
  );
}

/**
 * Kartu total: hanya kategori yang dianggarkan. `dari anggaran` sr-only supaya tidak terbaca
 * sebagai total pengeluaran (itu milik Laporan). Tidak dipanggil bila belum ada anggaran.
 */
export function BudgetTotalCard({
  totals: t,
  labelledBy,
}: {
  totals: BudgetTotalsVM;
  labelledBy: string;
}) {
  const level = budgetLevel({ pct: t.pct, remaining: t.remaining });
  return (
    <section
      aria-labelledby={labelledBy}
      className="flex flex-col gap-2.5 rounded-xl border border-hairline bg-surface p-4"
    >
      <h2 id={labelledBy} className="text-meta font-semibold text-text-soft">
        {RENCANA_COPY.used}
        <span className="sr-only"> dari anggaran</span>
      </h2>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <MoneyText value={t.spent} size="amount-sm" />
        <span className="text-label font-medium text-text-soft">
          dari <MoneyText value={t.budget} size="inherit" />
        </span>
      </p>
      <Bar level={level} pct={t.pct} />
      <p className={`flex items-center gap-1 text-meta font-bold ${TONE[level]}`}>
        {level === 'over' || level === 'full' ? (
          <WarningOctagonIcon size={16} weight="fill" />
        ) : level === 'near' ? (
          <WarningIcon size={16} weight="fill" />
        ) : null}
        {level === 'over' ? (
          <span>
            Lewat <MoneyText value={-t.remaining} size="inherit" />
          </span>
        ) : (
          <span>
            sisa <MoneyText value={t.remaining} size="inherit" />
          </span>
        )}
      </p>
    </section>
  );
}
