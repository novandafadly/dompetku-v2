'use client';

import { budgetProgress } from '@dompetku/demo-data';
import { formatRupiah } from '@dompetku/domain';
import { GaugeIcon } from '@/components/ui/icons/gauge';
import { EmptyLine, ListCard } from '@/components/ui/list-card';
import { BudgetRow } from '@/components/ui/budget-row';
import type { BerandaContext } from './context';

export function BudgetsNearLimit({ state, ruang, today }: BerandaContext) {
  const near = budgetProgress(state, ruang, today).filter((p) => p.pct >= 80);

  return (
    <ListCard title="Anggaran hampir habis" icon={<GaugeIcon size={18} />}>
      {near.length === 0 ? (
        <EmptyLine>Belum ada anggaran yang mendekati batas.</EmptyLine>
      ) : (
        <ul>
          {near.map((p) => (
            <BudgetRow
              key={p.budget.categoryId}
              name={p.category.name}
              wajib={p.budget.wajib}
              pct={p.pct}
              detail={`${formatRupiah(p.spent)} dari ${formatRupiah(p.budget.amount)} · sisa ${formatRupiah(Math.max(0, p.budget.amount - p.spent))}`}
            />
          ))}
        </ul>
      )}
    </ListCard>
  );
}
