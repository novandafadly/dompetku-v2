import { formatRupiah, spokenRupiah, type Rupiah } from '@dompetku/domain';
import type { CSSProperties } from 'react';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { MoneyText } from '@/components/ui/money-text';
import { card, focusRing } from '@/components/ui/styles';
import {
  axisLabel,
  barHeightPct,
  trendAriaLabel,
  trendLabel,
  trendScale,
  type TrendScale,
} from './present';
import type { TrendRowVM } from './types';

const HATCH: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(135deg, var(--chart-expense) 0 2px, var(--surface) 2px 5px)',
};

function Swatch({ kind }: { kind: 'income' | 'expense' | 'running' }) {
  if (kind === 'income') {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 rounded-xs border-2 border-chart-income bg-chart-income-tint"
      />
    );
  }
  if (kind === 'expense') {
    return <span aria-hidden="true" className="inline-block h-3 w-3 rounded-xs bg-chart-expense" />;
  }
  return (
    <span
      aria-hidden="true"
      style={HATCH}
      className="inline-block h-3 w-3 rounded-xs border-2 border-chart-expense"
    />
  );
}

/** Satu bilah; periode berjalan = arsir 135° (pengeluaran) / tepi putus-putus (pemasukan). */
function Bar({
  value,
  scale,
  kind,
  running,
}: {
  value: Rupiah;
  scale: TrendScale;
  kind: 'income' | 'expense';
  running: boolean;
}) {
  const style: CSSProperties = {
    height: `max(2px, ${String(barHeightPct(value, scale))}%)`,
    ...(kind === 'expense' && running ? HATCH : {}),
  };
  const cls =
    kind === 'income'
      ? `border-2 border-chart-income bg-chart-income-tint ${running ? 'border-dashed' : ''}`
      : running
        ? 'border-2 border-chart-expense'
        : 'bg-chart-expense';
  return (
    <span
      data-bar={kind}
      data-value={value}
      className={`block min-w-2 max-w-5 flex-1 rounded-t-sm laptop:max-w-7 ${cls}`}
      style={style}
    />
  );
}

/** Selisih bertanda `+`/`−` (U+2212). */
function signed(n: Rupiah, withRp: boolean): string {
  const body = withRp ? formatRupiah(Math.abs(n)) : formatRupiah(Math.abs(n)).replace(/^Rp\s/, '');
  return n > 0 ? `+${body}` : n < 0 ? `−${body}` : body;
}

/** Sel nominal tabel: HP tanpa `Rp` (caption `Dalam rupiah`), tablet ke atas penuh; pembaca layar ucapan penuh. */
function Cell({ n, sign = false }: { n: Rupiah; sign?: boolean }) {
  const spoken = spokenRupiah(n, 'neutral');
  return (
    <>
      <span aria-hidden="true" className="tablet:hidden">
        {sign ? signed(n, false) : formatRupiah(n).replace(/^Rp\s/, '')}
      </span>
      <span aria-hidden="true" className="hidden tablet:inline">
        {sign ? signed(n, true) : formatRupiah(n)}
      </span>
      <span className="sr-only">{spoken}</span>
    </>
  );
}

function DataTable({ rows, viewed }: { rows: readonly TrendRowVM[]; viewed: string }) {
  const th = 'py-1.5 text-right text-caption font-bold text-text-muted tablet:text-meta';
  return (
    <>
      {/* >= 360 px: tabel; di bawahnya nominal panjang tidak muat di kolom, jadi blok bertumpuk. */}
      <table
        className="w-full table-fixed border-collapse max-narrow:hidden"
        data-testid="laporan-tabel-tren"
      >
        <caption className="pb-1 text-left text-caption font-medium text-text-muted tablet:sr-only">
          Pemasukan, pengeluaran, dan selisih per periode.{' '}
          <span className="tablet:hidden">Dalam rupiah (Rp).</span>
        </caption>
        <thead>
          <tr>
            <th scope="col" className={`${th} w-9 text-left tablet:w-1/5`}>
              Periode
            </th>
            <th scope="col" className={th}>
              Pemasukan
            </th>
            <th scope="col" className={th}>
              Pengeluaran
            </th>
            <th scope="col" className={th}>
              Selisih
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.labelMonth}
              aria-current={r.labelMonth.slice(0, 7) === viewed ? 'true' : undefined}
              className={`border-t border-hairline text-caption font-medium text-text tablet:text-meta ${
                r.labelMonth.slice(0, 7) === viewed ? 'bg-surface-2' : ''
              }`}
            >
              <th scope="row" className="py-2 text-left font-bold">
                {trendLabel(r.labelMonth)}
                {r.isCurrent ? <span className="sr-only"> (berjalan)</span> : null}
              </th>
              <td className="py-2 text-right">
                <Cell n={r.pemasukan} />
              </td>
              <td className="py-2 text-right">
                <Cell n={r.pengeluaran} />
              </td>
              <td className="py-2 text-right">
                <Cell n={r.selisih} sign />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="hidden max-narrow:block" data-testid="laporan-tabel-tren-sempit">
        {rows.map((r) => (
          <li key={r.labelMonth} className="border-t border-hairline py-2.5 first:border-t-0">
            <p className="text-meta font-bold text-text">
              {trendLabel(r.labelMonth)}
              {r.isCurrent ? ' · berjalan' : ''}
              {r.labelMonth.slice(0, 7) === viewed ? ' · dilihat' : ''}
            </p>
            <dl className="mt-1 text-caption font-medium text-text-soft">
              {(
                [
                  ['Pemasukan', r.pemasukan, false],
                  ['Pengeluaran', r.pengeluaran, false],
                  ['Selisih', r.selisih, true],
                ] as const
              ).map(([label, n, sign]) => (
                <div key={label} className="flex items-baseline justify-between gap-2">
                  <dt>{label}</dt>
                  <dd className="whitespace-nowrap text-text">
                    <span aria-hidden="true">{sign ? signed(n, true) : formatRupiah(n)}</span>
                    <span className="sr-only">{spokenRupiah(n, 'neutral')}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Arus kas N periode (S9-LP1, LP5b): batang berpasangan pemasukan (kiri; isi `chart-income-tint`,
 * tepi 2 px `chart-income`) dan pengeluaran (kanan; `chart-expense` padat). Dibedakan oleh bentuk
 * dan posisi, bukan hue; periode berjalan berarsir/putus-putus + label `berjalan`. Render server
 * (elemen berpersen, K6), nol JavaScript klien, tanpa hover/tooltip. Grafik `role="img"` memakai
 * `aria-label` ringkas; angka lengkap ada di `<table>` setara. Satu periode = tanpa grafik.
 */
export function TrendChartView({
  rows,
  viewed,
  labelledBy,
}: {
  rows: readonly TrendRowVM[];
  /** `YYYY-MM` periode yang dilihat (ditandai bila ada di jendela). */
  viewed: string;
  labelledBy: string;
}) {
  const scale = trendScale(rows);
  const chart = rows.length >= 2;
  const hasRunning = rows.some((r) => r.isCurrent);
  const viewedRow = rows.find((r) => r.labelMonth.slice(0, 7) === viewed);
  const inWindow = viewedRow !== undefined;
  const label =
    trendAriaLabel(rows) +
    (inWindow
      ? ` Periode yang dilihat ditandai garis bawah pada ${trendLabel(`${viewed}-01`)}.`
      : '');
  return (
    <section
      aria-labelledby={labelledBy}
      data-testid="laporan-tren"
      className={`flex flex-col gap-3 px-4 py-3.5 ${card}`}
    >
      <h2 id={labelledBy} className="text-label font-bold text-text-soft">
        {`Arus kas ${String(rows.length)} periode`}
      </h2>
      {chart ? (
        <>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta font-medium text-text-soft">
            <li className="flex items-center gap-1.5">
              <Swatch kind="income" />
              Pemasukan
            </li>
            <li className="flex items-center gap-1.5">
              <Swatch kind="expense" />
              Pengeluaran
            </li>
            {hasRunning ? (
              <li className="flex items-center gap-1.5">
                <Swatch kind="running" />
                Periode berjalan
              </li>
            ) : null}
          </ul>
          {viewedRow ? (
            <p
              data-testid="laporan-tren-langsung"
              className="rounded-lg bg-surface-2 px-3 py-2 text-meta font-medium text-text-soft"
            >
              <span className="font-bold text-text">
                {trendLabel(viewedRow.labelMonth)}
                {viewedRow.isCurrent ? ' · berjalan' : ''}
              </span>
              {': Pemasukan '}
              <MoneyText value={viewedRow.pemasukan} size="inherit" />
              {' · Pengeluaran '}
              <MoneyText value={viewedRow.pengeluaran} size="inherit" />
            </p>
          ) : null}
          <div
            role="img"
            aria-label={label}
            data-testid="laporan-grafik"
            className="[--plot:150px] tablet:[--plot:170px] laptop:[--plot:190px]"
          >
            <div className="flex pt-2">
              <div aria-hidden="true" className="relative h-(--plot) w-12 shrink-0">
                {scale.ticks.map((t, i) => (
                  <span
                    key={t}
                    className="absolute right-2 translate-y-1/2 text-tag font-medium whitespace-nowrap text-text-muted"
                    style={{ bottom: `${String((i / 3) * 100)}%` }}
                  >
                    {axisLabel(t)}
                  </span>
                ))}
              </div>
              <div className="relative h-(--plot) flex-1">
                {scale.ticks.map((t, i) => (
                  <span
                    key={t}
                    aria-hidden="true"
                    className={`absolute inset-x-0 h-px ${i === 0 ? 'bg-border' : 'bg-hairline'}`}
                    style={i === 3 ? { top: 0 } : { bottom: `${String((i / 3) * 100)}%` }}
                  />
                ))}
                <div className="absolute inset-0 flex">
                  {rows.map((r) => (
                    <div
                      key={r.labelMonth}
                      className="flex flex-1 items-end justify-center gap-0.5 px-0.5"
                    >
                      <Bar value={r.pemasukan} scale={scale} kind="income" running={r.isCurrent} />
                      <Bar
                        value={r.pengeluaran}
                        scale={scale}
                        kind="expense"
                        running={r.isCurrent}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div aria-hidden="true" className="flex pl-12">
              {rows.map((r) => {
                const isViewed = r.labelMonth.slice(0, 7) === viewed;
                return (
                  <span
                    key={r.labelMonth}
                    className="flex flex-1 flex-col items-center pt-1.5 text-center"
                  >
                    <span
                      className={`text-caption ${
                        isViewed
                          ? 'font-extrabold text-text underline decoration-2 underline-offset-4'
                          : 'font-semibold text-text-soft'
                      }`}
                    >
                      {trendLabel(r.labelMonth)}
                    </span>
                    {r.isCurrent ? (
                      <span
                        className={`pt-1 text-tag font-semibold text-text-muted ${
                          rows.length >= 6 ? 'max-narrow:hidden' : ''
                        }`}
                      >
                        berjalan
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
      <details open={!chart} className="group">
        <summary
          className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-label font-bold text-text-soft [&::-webkit-details-marker]:hidden ${focusRing}`}
        >
          Tabel data
          <CaretDownIcon size={16} className="text-text-muted group-open:rotate-180" />
        </summary>
        <DataTable rows={rows} viewed={viewed} />
      </details>
    </section>
  );
}
