'use client';

import { safeToSpend } from '@dompetku/demo-data';
import { endOfMonth, formatRupiah, shortDateLabel } from '@dompetku/domain';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { CheckIcon } from '@/components/ui/icons/check';
import { PlusIcon } from '@/components/ui/icons/plus';
import { WarningOctagonIcon } from '@/components/ui/icons/warning-octagon';
import { MoneyText } from '@/components/ui/money-text';
import { SpaceTag } from '@/components/ui/space-tag';
import { heroCard } from '@/components/ui/styles';
import type { BerandaContext } from './context';

export function amanTitle(ruang: BerandaContext['ruang'], until: string): string {
  return `Aman dipakai${ruang === 'bersama' ? ' bersama' : ''} sampai ${until}`;
}

/** Kartu utama: surface, radius 20, padding 16 (laptop 24); judul + SpaceTag di baris pertama. */
export function AmanShell({
  ruang,
  title,
  children,
}: Pick<BerandaContext, 'ruang'> & { title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby="aman-dipakai"
      data-testid="balance-card"
      className={`flex flex-col gap-3 p-4 laptop:p-6 ${heroCard}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id="aman-dipakai" className="text-label font-semibold text-text-soft">
          {title}
        </h2>
        <SpaceTag space={ruang} />
      </div>
      {children}
    </section>
  );
}

function Swatch({ className }: { className: string }) {
  return (
    <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 rounded-xs ${className}`} />
  );
}

/**
 * Bilah proporsi: aman, tagihan (garis miring), sisa wajib (min 4 px, hilang bila 0).
 * role=img + aria-label berisi keempat angka; negatif = satu bilah bahaya bergaris.
 */
function ProportionBar({
  operasional,
  aman,
  tagihan,
  wajib,
}: {
  operasional: number;
  aman: number;
  tagihan: number;
  wajib: number;
}) {
  const label = `Saldo operasional ${formatRupiah(operasional)}: aman ${formatRupiah(aman)}, tagihan ${formatRupiah(tagihan)}, sisa anggaran wajib ${formatRupiah(wajib)}`;
  if (aman < 0) {
    return (
      <div
        role="img"
        aria-label={`${label}. Pengeluaran wajib melebihi saldo operasional.`}
        className="bg-hatch-danger mt-1 h-3 rounded-sm border border-danger"
      />
    );
  }
  return (
    <div role="img" aria-label={label} className="mt-1 flex h-3 gap-0.5 overflow-hidden rounded-sm">
      {aman > 0 ? <div className="bg-chart-aman" style={{ flex: `${String(aman)} 1 0` }} /> : null}
      {tagihan > 0 ? (
        <div className="bg-hatch-tagihan" style={{ flex: `${String(tagihan)} 1 0` }} />
      ) : null}
      {wajib > 0 ? (
        <div className="min-w-1 bg-chart-wajib" style={{ flex: `${String(wajib)} 0 0` }} />
      ) : null}
    </div>
  );
}

const breakdownRow = 'border-t border-hairline';
const cell = 'py-2.25 text-label';

export function SafeToSpend({ state, store, ruang, today }: BerandaContext) {
  const r = safeToSpend(state, ruang, today);
  const until = shortDateLabel(r.until);
  const negative = r.total < 0;

  const spentToday = state.entries.some(
    (e) =>
      e.ruang === ruang &&
      e.kind === 'expense' &&
      e.occurredOn === today &&
      e.voidedAt === undefined,
  );
  const marked = state.noSpendDays.some((d) => d.ruang === ruang && d.date === today);

  const rows: { label: string; value: number; swatch: string }[] = [
    {
      label: 'Saldo operasional',
      value: r.operasional,
      swatch: 'border-1.5 border-border',
    },
    { label: `Tagihan s.d. ${until}`, value: -r.billsUntilEom, swatch: 'bg-hatch-tagihan-sm' },
    { label: 'Sisa anggaran wajib', value: -r.budgetWajibRemaining, swatch: 'bg-chart-wajib' },
  ];

  return (
    <>
      <AmanShell ruang={ruang} title={amanTitle(ruang, until)}>
        <p data-testid="hero-amount" className={negative ? 'text-danger' : 'text-text'}>
          <MoneyText value={r.total} size="hero" />
        </p>
        {negative ? (
          <p className="flex items-start gap-2 rounded-lg bg-danger-tint px-3 py-2.5 text-label font-bold text-danger">
            <WarningOctagonIcon size={18} weight="fill" className="mt-px shrink-0" />
            <span>Pengeluaran wajib bulan ini melebihi saldo operasional.</span>
          </p>
        ) : (
          <p className="text-label font-medium text-text-soft">
            {'≈ '}
            <strong className="num font-extrabold text-text">{formatRupiah(r.perDay)}</strong>
            {` per hari untuk ${String(r.daysLeft)} hari`}
          </p>
        )}
        <ProportionBar
          operasional={r.operasional}
          aman={r.total}
          tagihan={r.billsUntilEom}
          wajib={r.budgetWajibRemaining}
        />
        <table className="w-full border-collapse">
          <caption className="sr-only">Rincian aman dipakai</caption>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={breakdownRow}>
                <th scope="row" className={`${cell} text-left font-medium text-text-soft`}>
                  <span className="flex items-center gap-2">
                    <Swatch className={row.swatch} />
                    {row.label}
                  </span>
                </th>
                <td className={`${cell} text-right`}>
                  <MoneyText value={row.value} size="row" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={breakdownRow}>
              <th scope="row" className={`${cell} text-left font-extrabold text-text`}>
                <span className="flex items-center gap-2">
                  <Swatch className={negative ? 'bg-danger' : 'bg-chart-aman'} />
                  Aman dipakai
                </span>
              </th>
              <td className={`${cell} text-right`}>
                <MoneyText
                  value={r.total}
                  size="inherit"
                  className={`font-extrabold ${negative ? 'text-danger' : 'text-accent-text'}`}
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </AmanShell>
      {marked ? (
        <p className="flex min-h-11 items-center gap-2 text-label font-semibold text-text-soft">
          <CheckCircleIcon size={20} weight="fill" className="shrink-0 text-accent-text" />
          <span>Hari ini tercatat tanpa pengeluaran</span>
        </p>
      ) : !spentToday ? (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => {
            store.markNoSpendDay(ruang, today);
          }}
        >
          <CheckIcon size={18} weight="bold" />
          Tidak ada pengeluaran hari ini
        </Button>
      ) : null}
    </>
  );
}

/** B3: belum ada dompet operasional. Tanpa angka sama sekali (tidak pernah "Rp 0"). */
export function SafeToSpendEmpty({
  ruang,
  today,
  onAddWallet,
}: Pick<BerandaContext, 'ruang' | 'today'> & { onAddWallet: () => void }) {
  const until = shortDateLabel(endOfMonth(today));
  return (
    <AmanShell ruang={ruang} title={amanTitle(ruang, until)}>
      <p className="text-heading/snug font-bold text-pretty text-text">
        Tambahkan dompet operasional untuk melihat berapa yang aman dipakai bulan ini.
      </p>
      <Button className="self-start" onClick={onAddWallet}>
        <PlusIcon size={18} weight="bold" />
        Tambah dompet
      </Button>
    </AmanShell>
  );
}
