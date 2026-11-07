import { formatRupiah, shortDateLabel } from '@dompetku/domain';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { InfoIcon } from '@/components/ui/icons/info';
import { WarningIcon } from '@/components/ui/icons/warning';
import { WarningOctagonIcon } from '@/components/ui/icons/warning-octagon';
import { MoneyText } from '@/components/ui/money-text';
import { SpaceTag } from '@/components/ui/space-tag';
import { heroCard } from '@/components/ui/styles';
import type { AmanReason, Ruang, SafeToSpendFullVM } from '@/features/ledger/types';

/**
 * Kartu utama "Aman dipakai" mode nyata (S9-BR1). Server Component, tanpa `'use client'` dan tanpa
 * impor demo: `SafeToSpendCard` prototipe tidak diubah (budget Beranda prototipe). Semua angka
 * dan status datang dari SQL + `amanStatus` (loader); komponen hanya memformat. Status = ikon +
 * teks, bukan warna saja.
 */

function Swatch({ className }: { className: string }) {
  return (
    <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 rounded-xs ${className}`} />
  );
}

/** Bilah proporsi (sama dengan prototipe): aman, tagihan, sisa wajib; negatif = satu bilah bahaya. */
function ProportionBar({
  vm,
  showObligations,
}: {
  vm: SafeToSpendFullVM;
  showObligations: boolean;
}) {
  const tagihan = showObligations ? vm.billsUntilEom : 0;
  const wajib = showObligations ? vm.budgetWajibRemaining : 0;
  const base = `Saldo operasional ${formatRupiah(vm.operasional)}: aman ${formatRupiah(vm.aman)}`;
  const label = showObligations
    ? `${base}, tagihan ${formatRupiah(vm.billsUntilEom)}, sisa anggaran wajib ${formatRupiah(vm.budgetWajibRemaining)}`
    : base;
  if (vm.aman < 0) {
    return (
      <div
        role="img"
        aria-label={`${label}. ${negativeText(showObligations)}`}
        className="bg-hatch-danger mt-1 h-3 rounded-sm border border-danger"
      />
    );
  }
  return (
    <div role="img" aria-label={label} className="mt-1 flex h-3 gap-0.5 overflow-hidden rounded-sm">
      {vm.aman > 0 ? (
        <div className="bg-chart-aman" style={{ flex: `${String(vm.aman)} 1 0` }} />
      ) : null}
      {tagihan > 0 ? (
        <div className="bg-hatch-tagihan" style={{ flex: `${String(tagihan)} 1 0` }} />
      ) : null}
      {wajib > 0 ? (
        <div className="min-w-1 bg-chart-wajib" style={{ flex: `${String(wajib)} 0 0` }} />
      ) : null}
    </div>
  );
}

function negativeText(showObligations: boolean): string {
  return showObligations
    ? 'Pengeluaran wajib periode ini melebihi saldo operasional.'
    : 'Saldo operasional sudah minus.';
}

/** Kalimat sebab `Hati-hati` (K7): `overdue` menang atas `pace`; Bersama berkata "belanja bersama". */
export function reasonText(reason: AmanReason, ruang: Ruang): string | null {
  if (reason === null) return null;
  if (reason.kind === 'overdue') return `Ada ${String(reason.count)} tagihan lewat jatuh tempo.`;
  const avg = formatRupiah(reason.avgDaily);
  return ruang === 'bersama'
    ? `Rata-rata belanja bersama ${avg} per hari, lebih dari jatah harian.`
    : `Rata-rata belanjamu ${avg} per hari, lebih dari jatah harian.`;
}

const breakdownRow = 'border-t border-hairline';
const cell = 'py-2.25 text-label';

export function AmanCardView({
  ruang,
  vm,
  holidayNote,
}: {
  ruang: Ruang;
  vm: SafeToSpendFullVM;
  /** Data libur tahun akhir periode kosong dan periode memakai gajian (bukan bulan kalender). */
  holidayNote: boolean;
}) {
  const until = shortDateLabel(vm.until);
  const showObligations = vm.hasObligations;
  const negative = vm.status === 'lewat';
  const sentence = negative ? negativeText(showObligations) : reasonText(vm.reason, ruang);

  const rows: { label: string; value: number; swatch: string }[] = [
    { label: 'Saldo operasional', value: vm.operasional, swatch: 'border-1.5 border-border' },
  ];
  if (showObligations) {
    rows.push(
      { label: `Tagihan s.d. ${until}`, value: -vm.billsUntilEom, swatch: 'bg-hatch-tagihan-sm' },
      { label: 'Sisa anggaran wajib', value: -vm.budgetWajibRemaining, swatch: 'bg-chart-wajib' },
    );
  }

  return (
    <section
      aria-labelledby="aman-dipakai"
      data-testid="balance-card"
      className={`flex flex-col gap-3 p-4 laptop:p-6 ${holidayNote ? '' : 'pb-1.75 laptop:pb-3.75'} ${heroCard}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id="aman-dipakai" className="text-label font-semibold text-text-soft">
          {`Aman dipakai${ruang === 'bersama' ? ' bersama' : ''} sampai `}
          <span className="whitespace-nowrap">{until}</span>
        </h2>
        <SpaceTag space={ruang} />
      </div>
      <p data-testid="hero-amount" className={negative ? 'text-danger' : 'text-text'}>
        <MoneyText value={vm.aman} size="hero" />
      </p>
      {negative ? null : (
        <p className="text-label font-medium text-text-soft">
          {'≈ '}
          <strong className="num font-extrabold text-text">{formatRupiah(vm.perDay)}</strong>
          {` per hari untuk ${String(vm.daysLeft)} hari`}
        </p>
      )}
      {vm.status === 'aman' ? (
        <p
          data-testid="aman-status"
          className="flex items-center gap-1.5 text-meta font-bold text-accent-text"
        >
          <CheckCircleIcon size={16} weight="fill" className="shrink-0" />
          Aman
        </p>
      ) : (
        <div
          data-testid="aman-status"
          className={`flex items-start gap-2 rounded-lg px-3 py-2.5 ${negative ? 'bg-danger-tint' : 'bg-warning-tint'}`}
        >
          {negative ? (
            <WarningOctagonIcon size={16} weight="fill" className="mt-0.5 shrink-0 text-danger" />
          ) : (
            <WarningIcon size={16} weight="fill" className="mt-0.5 shrink-0 text-warning" />
          )}
          <p className="min-w-0 text-label">
            <strong className={`block font-extrabold ${negative ? 'text-danger' : 'text-warning'}`}>
              {negative ? 'Lewat batas' : 'Hati-hati'}
            </strong>
            {sentence === null ? null : (
              <span className={`font-medium ${negative ? 'text-danger' : 'text-text-soft'}`}>
                {sentence}
              </span>
            )}
          </p>
        </div>
      )}
      <ProportionBar vm={vm} showObligations={showObligations} />
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
                value={vm.aman}
                size="inherit"
                className={`font-extrabold ${negative ? 'text-danger' : 'text-accent-text'}`}
              />
            </td>
          </tr>
        </tfoot>
      </table>
      {holidayNote ? (
        <p className="flex items-start gap-1.5 text-meta font-medium text-text-muted">
          <InfoIcon size={14} className="mt-0.5 shrink-0" />
          {`Libur nasional ${vm.until.slice(0, 4)} belum diisi; hari gajian dihitung tanpa libur.`}
        </p>
      ) : null}
    </section>
  );
}
