'use client';

import type { BudgetProgress, MonthSummary } from '@dompetku/demo-data';
import { formatRupiah } from '@dompetku/domain';
import { GaugeIcon } from '@/components/ui/icons/gauge';
import { ListCard } from '@/components/ui/list-card';
import { BudgetRow } from '@/components/ui/rows';
import { SummaryViewVM } from './summary-view-vm';

/**
 * Pembungkus demo: ringkasan + anggaran, dirender lewat `SummaryViewVM`. Angkanya dihitung
 * pemanggil dari store demo; modul ini dimuat malas dan sengaja tidak mengimpor demo-data saat
 * runtime (agar pemisahan chunk tidak memecah modul demo bersama rute lain).
 */
export function SummaryView({
  month,
  summary: s,
  budgets,
}: {
  month: string;
  summary: MonthSummary;
  budgets: BudgetProgress[];
}) {
  return (
    <SummaryViewVM month={month} summary={s} kantor={s.kantor}>
      {budgets.length === 0 ? null : (
        <ListCard title="Anggaran bulan ini" icon={<GaugeIcon size={18} />}>
          <ul>
            {budgets.map((p) => (
              <BudgetRow
                key={p.budget.categoryId}
                name={p.category.name}
                wajib={p.budget.wajib}
                pct={p.pct}
                detail={`${formatRupiah(p.spent)} dari ${formatRupiah(p.budget.amount)} · sisa ${formatRupiah(Math.max(0, p.budget.amount - p.spent))}`}
              />
            ))}
          </ul>
        </ListCard>
      )}
    </SummaryViewVM>
  );
}
