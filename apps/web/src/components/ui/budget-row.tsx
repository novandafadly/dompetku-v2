import { WarningIcon } from './icons/warning';
import { WarningOctagonIcon } from './icons/warning-octagon';
import { rowDivider } from './styles';

// Satu berkas per jenis baris: rute hanya memuat baris yang dipakainya (ADR 0002).

/** Anggaran: nama (+ tag Wajib), status kanan (ikon + teks bila ≥ 80%), bilah 6 px, sub nominal. */
export function BudgetRow({
  name,
  wajib,
  pct,
  detail,
}: {
  name: string;
  wajib: boolean;
  pct: number;
  detail: string;
}) {
  const level = pct >= 100 ? 'over' : pct >= 80 ? 'near' : 'ok';
  const tone =
    level === 'over' ? 'text-danger' : level === 'near' ? 'text-warning' : 'text-text-soft';
  const bar = level === 'over' ? 'bg-danger' : level === 'near' ? 'bg-warning' : 'bg-chart-aman';
  return (
    <li className={`flex flex-col gap-2 py-3 ${rowDivider}`}>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-body/tight font-semibold text-text">
          <span className="truncate">{name}</span>
          {wajib ? (
            <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-tag/snug font-semibold text-text-soft">
              Wajib
            </span>
          ) : null}
        </span>
        <span className={`flex shrink-0 items-center gap-1 text-meta/none font-bold ${tone}`}>
          {level === 'over' ? (
            <WarningOctagonIcon size={16} weight="fill" />
          ) : level === 'near' ? (
            <WarningIcon size={16} weight="fill" />
          ) : null}
          <span className="num">{`${String(pct)}% terpakai`}</span>
        </span>
      </span>
      <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-sm bg-surface-2">
        <span
          className={`block h-full ${bar}`}
          style={{ width: `${String(Math.min(pct, 100))}%` }}
        />
      </span>
      <span className="text-meta font-medium text-text-muted">{detail}</span>
    </li>
  );
}
