import Link from 'next/link';
import { CaretLeftIcon } from '@/components/ui/icons/caret-left';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { InfoIcon } from '@/components/ui/icons/info';
import { segmentItem, segmentTrack } from '@/components/ui/segment-styles';
import { focusRing } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';
import { laporanHref } from './href';
import { bulanTahunLabel } from './present';
import type { LaporanPeriodVM } from './types';

const step = `inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text hover-pointer:bg-hover active:bg-surface-2 ${focusRing}`;
const stepOff =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-text-muted';

/** `November 2026 · 23 Okt – 24 Nov` → judul dan rentang. */
function splitLabel(label: string): { title: string; range: string } {
  const i = label.indexOf(' · ');
  return i < 0
    ? { title: label, range: '' }
    : { title: label.slice(0, i), range: label.slice(i + 3) };
}

function subtitle(period: LaporanPeriodVM, range: string): string {
  const tail = period.isCurrent
    ? `berjalan, ${String(period.daysLeft ?? 0)} hari lagi`
    : period.complete
      ? 'lengkap'
      : '';
  return [range, tail].filter((t) => t !== '').join(' · ');
}

/**
 * Pemilih periode + dasar periode (S9-LP1..LP4): tautan `?periode=…&basis=…` tanpa JS. ‹ aktif
 * sampai batas awal, › nonaktif di periode berjalan (`role="img"`, bukan tautan mati). Dasar
 * periode = `nav` + `aria-current` (bukan tablist, keputusan 1). Berganti dasar menyimpan bulan
 * yang dilihat, kecuali periode berjalan (tiap dasar punya periode berjalannya sendiri).
 */
export function PeriodPicker({
  ruang,
  period,
  query,
}: {
  ruang: Ruang;
  period: LaporanPeriodVM;
  query: string;
}) {
  const { title, range } = splitLabel(period.label);
  const { basis } = period;
  const viewed = period.labelMonth.slice(0, 7);
  const keep = period.isCurrent ? null : viewed;
  const holiday =
    basis === 'gajian' && !period.holidaysKnown && (period.isCurrent || !period.complete);
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Pilih periode" className="flex items-center gap-2">
        {period.prev === null ? (
          <span role="img" aria-label="Periode sebelumnya belum tersedia" className={stepOff}>
            <CaretLeftIcon size={20} weight="bold" />
          </span>
        ) : (
          <Link
            href={laporanHref(ruang, query, { periode: period.prev, basis })}
            aria-label={`Periode sebelumnya: ${bulanTahunLabel(period.prev)}`}
            className={step}
          >
            <CaretLeftIcon size={20} weight="bold" />
          </Link>
        )}
        <div className="min-w-0 flex-1 text-center">
          <p className="text-subheading font-extrabold text-text">{title}</p>
          <p className="text-meta font-medium text-text-muted">{subtitle(period, range)}</p>
        </div>
        {period.next === null ? (
          <span role="img" aria-label="Periode berikutnya belum tersedia" className={stepOff}>
            <CaretRightIcon size={20} weight="bold" />
          </span>
        ) : (
          <Link
            href={laporanHref(ruang, query, { periode: period.next, basis })}
            aria-label={`Periode berikutnya: ${bulanTahunLabel(period.next)}`}
            className={step}
          >
            <CaretRightIcon size={20} weight="bold" />
          </Link>
        )}
      </nav>
      <nav aria-label="Dasar periode" className={`${segmentTrack} w-full`}>
        {(
          [
            ['gajian', 'Periode gajian'],
            ['kalender', 'Bulan kalender'],
          ] as const
        ).map(([b, label]) => (
          <Link
            key={b}
            href={laporanHref(ruang, query, { periode: keep, basis: b })}
            aria-current={b === basis ? 'page' : undefined}
            className={segmentItem(b === basis)}
          >
            {label}
          </Link>
        ))}
      </nav>
      {holiday ? (
        <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-meta font-medium text-text-soft">
          <InfoIcon size={18} className="mt-px shrink-0" />
          <span>{`Libur nasional ${period.from.slice(0, 4)} belum diisi; hari gajian dihitung tanpa libur.`}</span>
        </p>
      ) : null}
    </div>
  );
}
