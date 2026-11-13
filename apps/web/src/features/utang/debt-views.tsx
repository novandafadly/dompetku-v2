import { formatRupiah, type Rupiah } from '@dompetku/domain';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { MoneyText } from '@/components/ui/money-text';
import { card, tile } from '@/components/ui/styles';
import { dateWithYear, debtHeading, UTANG_COPY } from './copy';
import { initialOf, paidCaption } from './present';
import type { DebtDirection, DebtListItemVM, DebtTotalVM } from './types';

/**
 * Tampilan Utang (S11-UT1/DT1). Server Component, tanpa `'use client'`: tombol dan pembuka sheet
 * dipasang pulau klien (`utang-islands`) di sekelilingnya, jadi isi di sini tidak membawa JS.
 * Tanpa merah dan tanpa hijau untuk angka utang (bingkai aturan 2): beda arah dibawa oleh kata,
 * urutan kelompok, dan judul. Utang bersisa 0 tampil `Lunas` (ikon + teks), tidak pernah `Rp 0`.
 */

const TILE_SIZE = { 9: 'size-9', 11: 'size-11', 12: 'size-12' } as const;

/** Ubin inisial kontak (dekoratif: nama kontak sudah ada sebagai teks). */
export function InitialTile({ name, size = 11 }: { name: string; size?: 9 | 11 | 12 }) {
  return (
    <span
      aria-hidden="true"
      className={`${TILE_SIZE[size]} ${tile} text-body font-extrabold text-text`}
    >
      {initialOf(name)}
    </span>
  );
}

/** Bilah terbayar (dekoratif; angkanya sudah teks); isi `chart-aman`, jalur `surface-2`. */
export function PaidBar({ pct, thick = false }: { pct: number; thick?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`${thick ? 'h-1.5' : 'h-1'} block w-full overflow-hidden rounded-sm bg-surface-2`}
    >
      <span
        className="block h-full bg-chart-aman"
        style={{ width: `${String(Math.min(Math.max(pct, 0), 100))}%` }}
      />
    </span>
  );
}

/** Status `Lunas`: ikon + teks `accent-text` (bukan warna saja). */
export function SettledMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-extrabold text-accent-text ${
        size === 'lg' ? 'text-title-lg' : 'text-label font-bold'
      }`}
    >
      <CheckCircleIcon size={size === 'lg' ? 28 : 16} weight="fill" className="shrink-0" />
      {UTANG_COPY.settled}
    </span>
  );
}

/** Nominal besar kartu `Sisa`: skala turun untuk nominal sangat panjang di HP (320 px). */
function BigMoney({ value }: { value: Rupiah }) {
  const long = formatRupiah(value).length > 13;
  return (
    <MoneyText
      value={value}
      size="inherit"
      className={`font-extrabold ${long ? 'text-headline min-[390px]:text-title-lg' : 'text-title-lg'}`}
    />
  );
}

function SisaRow({ label, total }: { label: string; total: DebtTotalVM }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-meta font-semibold text-text-soft">{label}</span>
      <BigMoney value={total.remaining} />
      <span className="text-caption font-medium text-text-muted">
        {UTANG_COPY.contactsCount(total.contacts)}
      </span>
    </div>
  );
}

/**
 * Kartu `Sisa` (UT1): satu baris per arah, ditumpuk (bukan berdampingan: `Rp 12.345.678.900`
 * tidak muat dua kolom di 320). Arah yang totalnya 0 tidak dirender; keduanya 0 = tanpa kartu.
 */
export function SisaCard({ totals }: { totals: Record<DebtDirection, DebtTotalVM> }) {
  const borrowed = totals.borrowed.remaining > 0;
  const lent = totals.lent.remaining > 0;
  if (!borrowed && !lent) return null;
  return (
    <section aria-label={UTANG_COPY.remaining} className={`${card} flex flex-col gap-3 p-4`}>
      {borrowed ? <SisaRow label={UTANG_COPY.borrowed} total={totals.borrowed} /> : null}
      {lent ? <SisaRow label={UTANG_COPY.lent} total={totals.lent} /> : null}
    </section>
  );
}

/**
 * Badan baris utang bersisa: ubin inisial, nama (maks dua baris), judul, lalu sisa, bilah, dan
 * caption. Nominal ada di badan; kolom kanan hanya berisi tombol, jadi nominal panjang tidak
 * berebut ruang dengan nama. Nama aksesibel disusun dari isi terlihat (awalan sr-only).
 */
export function DebtBodyView({ debt }: { debt: DebtListItemVM }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1.5 text-left">
      <span className="flex items-start gap-3">
        <InitialTile name={debt.contactName} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body/tight font-semibold text-text">
            <span className="sr-only">
              {debt.direction === 'lent' ? 'Piutang pada ' : 'Utang ke '}
            </span>
            <span className="line-clamp-2 break-words">
              {debt.contactName}
              <CaretRightIcon
                size={16}
                className="ml-1 inline-block align-text-bottom text-text-muted"
              />
            </span>
          </span>
          {debt.title === null ? null : (
            <span className="line-clamp-1 text-meta font-medium break-words text-text-muted">
              {debt.title}
            </span>
          )}
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-1 min-[390px]:pl-14">
        <span className="text-label font-bold whitespace-nowrap text-text">
          {`${UTANG_COPY.remainingOf} `}
          <MoneyText value={debt.remaining} size="inherit" />
        </span>
        <PaidBar pct={debt.paidPct} />
        <span className="text-caption font-medium text-text-muted">
          {paidCaption(debt.paidPct, debt.principal)}
        </span>
      </span>
    </span>
  );
}

/** Baris baca-saja utang lunas: nama, `Lunas`, dan pokok. */
export function SettledRowView({ debt }: { debt: DebtListItemVM }) {
  return (
    <span className="flex min-h-15.5 w-full items-center gap-3 py-2.5 text-left">
      <InitialTile name={debt.contactName} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 break-words text-body/tight font-semibold text-text">
          <span className="sr-only">
            {debt.direction === 'lent' ? 'Piutang pada ' : 'Utang ke '}
          </span>
          {debt.contactName}
        </span>
        <SettledMark />
      </span>
      <span className="whitespace-nowrap text-text-soft">
        <MoneyText value={debt.principal} />
      </span>
    </span>
  );
}

/** Isi baris utang dihapus (tombol `Pulihkan` dipasang pemanggil di kolom kanan). */
export function DeletedBodyView({ debt }: { debt: DebtListItemVM }) {
  const day = (debt.voidedAt ?? '').slice(0, 10);
  return (
    <span className="flex min-h-15.5 min-w-0 flex-1 items-center gap-3 py-2.5 text-left">
      <InitialTile name={debt.contactName} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 break-words text-body/tight font-semibold text-text-soft">
          {debtHeading(debt.direction, debt.contactName)}
        </span>
        <span className="text-meta font-medium text-text-muted">
          {day === '' ? '' : UTANG_COPY.deletedOn(dateWithYear(day))}
        </span>
      </span>
    </span>
  );
}
