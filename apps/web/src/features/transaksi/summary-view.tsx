'use client';

import { budgetProgress, monthSummary } from '@dompetku/demo-data';
import { formatRupiah, monthYearLabel } from '@dompetku/domain';
import { ChartBarIcon } from '@/components/ui/icons/chart-bar';
import { GaugeIcon } from '@/components/ui/icons/gauge';
import { InfoIcon } from '@/components/ui/icons/info';
import { ListCard } from '@/components/ui/list-card';
import { MoneyText } from '@/components/ui/money-text';
import { BudgetRow } from '@/components/ui/rows';
import type { TransaksiContext } from './context';

const row = 'border-t border-hairline first:border-t-0';
const cell = 'h-13 text-body';

export function SummaryView({
  state,
  ruang,
  month,
}: Pick<TransaksiContext, 'state' | 'ruang'> & { month: string }) {
  const s = monthSummary(state, ruang, month);
  const budgets = budgetProgress(state, ruang, `${month}-01`);
  return (
    <div className="flex flex-col gap-3 tablet:gap-4">
      <ListCard title={monthYearLabel(month)} icon={<ChartBarIcon size={18} />} className="pb-4">
        <table className="w-full border-collapse">
          <caption className="sr-only">Ringkasan bulan</caption>
          <tbody>
            <tr className={row}>
              <th scope="row" className={`${cell} text-left font-medium text-text-soft`}>
                Pemasukan
              </th>
              <td className={`${cell} text-right`}>
                <MoneyText value={s.pemasukan} />
              </td>
            </tr>
            <tr className={row}>
              <th scope="row" className={`${cell} text-left font-medium text-text-soft`}>
                Pengeluaran
              </th>
              <td className={`${cell} text-right`}>
                <MoneyText value={s.pengeluaran} />
              </td>
            </tr>
            <tr className={row}>
              <th scope="row" className={`${cell} text-left font-extrabold text-text`}>
                Selisih
              </th>
              <td className={`${cell} text-right`}>
                <MoneyText
                  value={s.selisih}
                  size="inherit"
                  className="text-headline font-extrabold"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-surface-2 px-3.5 py-3 text-label font-medium text-text-soft">
          <InfoIcon size={18} className="mt-px shrink-0" />
          <span>{`Tidak termasuk: Kas kantor ${formatRupiah(s.kantor)}, Transfer internal ${formatRupiah(s.transfer)}`}</span>
        </p>
      </ListCard>
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
    </div>
  );
}
