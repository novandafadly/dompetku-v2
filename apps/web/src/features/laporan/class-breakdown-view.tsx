import { InfoIcon } from '@/components/ui/icons/info';
import { MoneyText } from '@/components/ui/money-text';
import type { ExcludedLine } from './present';

/**
 * `Tidak termasuk` (S9-LP1): uang yang bergerak tetapi bukan Pemasukan atau Pengeluaran (kelas
 * `x_*` dari `api.excluded_summary`). Hanya baris > 0; tanpa baris, kartu tidak dirender.
 */
export function ClassBreakdownView({
  lines,
  labelledBy,
}: {
  lines: readonly ExcludedLine[];
  labelledBy: string;
}) {
  if (lines.length === 0) return null;
  return (
    <section
      aria-labelledby={labelledBy}
      data-testid="laporan-tidak-termasuk"
      className="flex flex-col rounded-xl border border-hairline bg-surface-2 px-4 py-3.5"
    >
      <h2 id={labelledBy} className="flex items-center gap-2 text-label font-bold text-text-soft">
        <InfoIcon size={18} />
        Tidak termasuk
      </h2>
      <p className="text-meta font-medium text-text-muted">
        Uang yang bergerak, tetapi bukan pemasukan atau pengeluaran.
      </p>
      <ul className="mt-1">
        {lines.map((l) => (
          <li
            key={l.key}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-hairline py-2.5 first:mt-1"
          >
            <div className="min-w-0 grow shrink basis-36">
              <p className="text-body font-semibold text-text">{l.name}</p>
              <p className="text-meta font-medium text-text-muted">{l.note}</p>
            </div>
            <MoneyText value={l.amount} className="ml-auto" />
          </li>
        ))}
      </ul>
    </section>
  );
}
