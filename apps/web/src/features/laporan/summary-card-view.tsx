import { formatRupiah, monthName, spokenRupiah } from '@dompetku/domain';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowDownIcon } from '@/components/ui/icons/arrow-down';
import { CircleIcon } from '@/components/ui/icons/circle';
import { InfoIcon } from '@/components/ui/icons/info';
import { MinusCircleIcon } from '@/components/ui/icons/minus-circle';
import { PlusCircleIcon } from '@/components/ui/icons/plus-circle';
import { MoneyText } from '@/components/ui/money-text';
import { SpaceTag } from '@/components/ui/space-tag';
import { heroCard } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';
import { bigNumberEm } from './present';
import type { LaporanPeriodVM, LaporanSummaryVM } from './types';

/**
 * Angka besar Pengeluaran: `Rp` kecil + digit yang mengecil agar satu baris (SPEC §7). Ukuran =
 * `min(44px, (lebar kartu − 30px) / em)`; `em` dihitung server dari jumlah digit dan titik. Kartu
 * adalah container (`container-type: inline-size`) sehingga `cqw` mengukur kartu, bukan layar.
 */
function BigAmount({ value }: { value: number }) {
  const digits = formatRupiah(value).replace(/^Rp\s/, '');
  const style = {
    '--em': String(bigNumberEm(digits)),
  } as CSSProperties;
  return (
    <p className="num flex items-baseline gap-1.5 whitespace-nowrap">
      <span aria-hidden="true" className="text-headline font-bold text-text-muted">
        Rp
      </span>
      <span
        aria-hidden="true"
        data-testid="laporan-angka-besar"
        className="laporan-angka leading-none font-extrabold"
        style={style}
      >
        {digits}
      </span>
      <span className="sr-only">{spokenRupiah(value, 'expense')}</span>
    </p>
  );
}

function LedgerRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-hairline py-2.25 text-label font-medium text-text first:border-t-0">
      <dt>{label}</dt>
      <dd className="ml-auto">{children}</dd>
    </div>
  );
}

function Note({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-meta font-medium text-text-soft">
      <span className="mt-px shrink-0 text-text-muted">{icon ?? <InfoIcon size={16} />}</span>
      <span>{children}</span>
    </p>
  );
}

/** Catatan pembanding / periode (keputusan 2: periode berjalan tidak dibandingkan). */
function buildNotes(period: LaporanPeriodVM, summary: LaporanSummaryVM): ReactNode[] {
  const prevName = monthName(summary.previous.labelMonth.slice(0, 7));
  const notes: ReactNode[] = [];
  if (period.isCurrent) {
    notes.push(<Note key="run">Periode belum selesai; angka masih bisa bertambah.</Note>);
    if (summary.previous.pengeluaran > 0) {
      notes.push(
        <Note key="prev">
          {`${prevName} (lengkap): `}
          <MoneyText value={summary.previous.pengeluaran} size="inherit" /> pengeluaran.
        </Note>,
      );
    }
  } else if (summary.deltaPengeluaran !== null) {
    const d = summary.deltaPengeluaran;
    notes.push(
      d === 0 ? (
        <Note key="delta">{`Sama seperti ${prevName}`}</Note>
      ) : (
        <Note key="delta" icon={<ArrowDownIcon size={16} className={d > 0 ? 'rotate-180' : ''} />}>
          <MoneyText value={Math.abs(d)} size="inherit" />
          {d < 0 ? ' lebih sedikit dari ' : ' lebih banyak dari '}
          {prevName}
        </Note>
      ),
    );
  }
  if (period.basis === 'kalender') {
    notes.push(
      <Note key="kal">
        Bulan kalender memotong periode gajian, jadi angkanya bisa berbeda dari tampilan periode
        gajian.
      </Note>,
    );
  }
  return notes;
}

/**
 * Ringkasan periode (S9-LP1): Pengeluaran besar, buku besar tiga baris (Pemasukan, Pengeluaran,
 * Selisih dengan kata + ikon), catatan. Server Component. Semua nominal dari `period_trend` (SQL).
 */
export function SummaryCardView({
  ruang,
  period,
  summary,
  title,
  labelledBy,
}: {
  ruang: Ruang;
  period: LaporanPeriodVM;
  summary: LaporanSummaryVM;
  /** Nama periode (`Oktober 2026`). */
  title: string;
  labelledBy: string;
}) {
  const sel = summary.selisih;
  const notes = buildNotes(period, summary);
  return (
    <section
      aria-labelledby={labelledBy}
      data-testid="laporan-ringkasan"
      className={`flex flex-col gap-3 p-4 @container laptop:p-6 ${heroCard}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={labelledBy} className="text-label font-bold text-text-soft">
          {`Pengeluaran ${title}`}
        </h2>
        <SpaceTag space={ruang} />
      </div>
      <BigAmount value={summary.pengeluaran} />
      <dl>
        <LedgerRow label="Pemasukan">
          <MoneyText
            value={summary.pemasukan}
            kind={summary.pemasukan > 0 ? 'income' : 'neutral'}
            size="inherit"
            className="font-bold"
          />
        </LedgerRow>
        <LedgerRow label="Pengeluaran">
          <MoneyText
            value={summary.pengeluaran === 0 ? 0 : -summary.pengeluaran}
            size="inherit"
            className="font-bold"
          />
        </LedgerRow>
        <LedgerRow
          label={
            <span className="flex items-center gap-1.5 font-extrabold">
              {sel > 0 ? (
                <PlusCircleIcon size={14} weight="fill" className="text-income" />
              ) : sel < 0 ? (
                <MinusCircleIcon size={14} weight="fill" className="text-danger" />
              ) : (
                <CircleIcon size={14} className="text-text-soft" />
              )}
              <span>Selisih</span>
              <span className="font-bold">
                {sel > 0 ? 'Surplus' : sel < 0 ? 'Defisit' : 'Seimbang'}
              </span>
            </span>
          }
        >
          <MoneyText
            value={sel}
            kind={sel > 0 ? 'income' : 'neutral'}
            size="inherit"
            className={`font-extrabold ${sel < 0 ? 'text-danger' : ''}`}
          />
        </LedgerRow>
      </dl>
      {notes.length > 0 ? <div className="flex flex-col gap-1.5">{notes}</div> : null}
    </section>
  );
}
