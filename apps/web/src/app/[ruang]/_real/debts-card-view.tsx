import { formatRupiah } from '@dompetku/domain';
import Link from 'next/link';
import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { HandCoinsIcon } from '@/components/ui/icons/hand-coins';
import { ListCard } from '@/components/ui/list-card';
import { MoneyText } from '@/components/ui/money-text';
import { focusRing } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';
import { buildDebtListHref } from '@/features/shell/utang-hrefs';
import type { DebtCardVM } from '@/features/utang/types';

/** Salinan final S12-UT1 (`docs/design/s12-bingkai.md`). */
const COPY = {
  title: 'Utang yang harus dibayar',
  titleLentOnly: 'Piutang yang masih ditagih',
  remaining: 'Sisa utang',
  lent: 'Piutang',
  activeDebts: (n: number) => `${String(n)} utang aktif`,
  activeLent: (n: number) => `${String(n)} piutang aktif`,
  link: 'Lihat utang',
  note: 'Tidak mengurangi angka Aman dipakai.',
} as const;

/**
 * Kartu `Utang yang harus dibayar` mode nyata (S12-UT1, K1): Server Component murni, tanpa JS baru.
 * Angka dari SQL (`api.debt_totals`), netral tanpa hue (arah dibawa kata), tidak mengubah "aman
 * dipakai". Pemanggil tidak merender kartu bila `data` null (nol, Bersama, atau gagal dimuat).
 * Jumlah aktif per arah hanya ditampilkan bila arah itu satu-satunya (SQL memberi satu hitungan).
 */
export function DebtsCard({
  ruang,
  query,
  data,
}: {
  ruang: Ruang;
  query: string;
  data: DebtCardVM;
}) {
  const hasBorrowed = data.borrowed > 0;
  const hasLent = data.lent > 0;
  const both = hasBorrowed && hasLent;
  // Dua nominal besar di 320 px memakai skala yang sama (pola `SisaCard`).
  const long = formatRupiah(data.borrowed).length > 13 || formatRupiah(data.lent).length > 13;
  return (
    <ListCard
      title={hasBorrowed ? COPY.title : COPY.titleLentOnly}
      icon={<HandCoinsIcon size={18} />}
    >
      <div className="flex flex-col gap-3 pt-1 pb-1">
        {hasBorrowed ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-meta font-semibold text-text-soft">{COPY.remaining}</span>
            <MoneyText
              value={data.borrowed}
              size="inherit"
              className={`font-extrabold ${long ? 'text-headline min-[390px]:text-title-lg' : 'text-title-lg'}`}
            />
            {both ? null : (
              <span className="text-caption font-medium text-text-muted">
                {COPY.activeDebts(data.activeCount)}
              </span>
            )}
          </div>
        ) : null}
        {hasLent ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-meta font-semibold text-text-soft">{COPY.lent}</span>
            <MoneyText value={data.lent} />
            {both ? null : (
              <span className="text-caption font-medium text-text-muted">
                {COPY.activeLent(data.activeCount)}
              </span>
            )}
          </div>
        ) : null}
        {hasBorrowed ? (
          <p className="text-caption font-medium text-text-muted">{COPY.note}</p>
        ) : null}
      </div>
      <Link
        href={buildDebtListHref(ruang, query)}
        className={`-ml-2 inline-flex min-h-11 items-center gap-0.5 self-start rounded-md px-2 text-meta font-bold text-accent-text hover-pointer:underline ${focusRing}`}
      >
        {COPY.link}
        <CaretRightIcon size={16} weight="bold" />
      </Link>
    </ListCard>
  );
}
