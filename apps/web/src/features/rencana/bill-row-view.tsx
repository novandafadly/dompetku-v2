import { CaretRightIcon } from '@/components/ui/icons/caret-right';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { ClockIcon } from '@/components/ui/icons/clock';
import { MinusCircleIcon } from '@/components/ui/icons/minus-circle';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { MoneyText } from '@/components/ui/money-text';
import { tile } from '@/components/ui/styles';
import { dueSub, tileOf, type BillItem, type DueIcon, type DueTone } from './bills';
import { TAGIHAN_COPY } from './copy';
import type { BillListVM } from './types';

/**
 * Tampilan baris Tagihan (S9-TG1). Server Component, tanpa `'use client'`: pembuka sheet Ubah dan
 * tombol Bayar/Batalkan lewati dipasang pulau klien di sekelilingnya (`rencana-islands`), jadi isi
 * di sini tidak punya penangan dan tidak membawa JS. `BillRow` prototipe tidak dipakai/diubah.
 */

const TONE: Record<DueTone, string> = {
  muted: 'text-text-muted',
  danger: 'text-danger',
  accent: 'text-accent-text',
};

function SubIcon({ icon }: { icon: DueIcon }) {
  switch (icon) {
    case 'warning':
      return <WarningCircleIcon size={14} weight="fill" className="shrink-0" />;
    case 'check':
      return <CheckCircleIcon size={14} weight="fill" className="shrink-0" />;
    case 'skip':
      return <MinusCircleIcon size={14} weight="fill" className="shrink-0" />;
    case 'clock':
      return <ClockIcon size={14} className="shrink-0" />;
    case null:
      return null;
  }
}

/** Ubin tanggal 44×44 (`aria-hidden`: tanggal dan status ikut terbaca di sub). */
function DateTile({ item }: { item: BillItem }) {
  const overdue = item.occ?.overdue === true;
  const t = item.occ === null ? null : tileOf(item.occ.dueOn);
  return (
    <span
      aria-hidden="true"
      className={`size-11 flex-col gap-0.5 ${tile} ${overdue ? 'bg-danger-tint' : ''}`}
    >
      <span
        className={`text-tiny font-bold tracking-eyebrow uppercase ${overdue ? 'text-danger' : 'text-text-muted'}`}
      >
        {t === null ? 'Tgl' : t.weekday}
      </span>
      <span
        className={`text-subheading/none font-extrabold ${overdue ? 'text-danger' : 'text-text'}`}
      >
        {t === null ? item.bill.dayOfMonth : t.day}
      </span>
    </span>
  );
}

/**
 * Badan baris: ubin tanggal, nama (maks dua baris), sub status. `caret` = isyarat bahwa badan ini
 * membuka sheet Ubah. Nama aksesibel disusun dari isi yang terlihat (`Ubah tagihan` sr-only di awal).
 */
export function BillBodyView({ item, caret }: { item: BillItem; caret: boolean }) {
  const sub =
    item.occ === null
      ? {
          text: TAGIHAN_COPY.everyMonth(item.bill.dayOfMonth),
          tone: 'muted' as const,
          icon: 'clock' as const,
        }
      : dueSub(item.occ);
  return (
    <>
      <DateTile item={item} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.75 text-left">
        <span className="flex items-start gap-1 text-body/tight font-semibold text-text">
          {caret ? <span className="sr-only">Ubah tagihan </span> : null}
          <span className="line-clamp-2 min-w-0 break-words">{item.bill.name}</span>
          {caret ? <CaretRightIcon size={16} className="mt-0.5 shrink-0 text-text-muted" /> : null}
        </span>
        <span className={`flex items-center gap-1 text-meta font-semibold ${TONE[sub.tone]}`}>
          <SubIcon icon={sub.icon} />
          {sub.text}
        </span>
      </span>
    </>
  );
}

/** Kolom kanan: nominal di atas, aksi (Bayar / Batalkan lewati) di bawahnya, rata kanan. */
export function BillAmountColumn({
  amount,
  children,
}: {
  amount: number;
  children?: React.ReactNode;
}) {
  return (
    <span className="ml-auto flex shrink-0 flex-col items-end justify-center gap-1.5 py-2 pr-4">
      <span className="whitespace-nowrap">
        <MoneyText value={amount} />
      </span>
      {children}
    </span>
  );
}

/** Baris tagihan terarsip: baca-saja, nominal perkiraan terakhir. */
export function ArchivedBillView({ bill }: { bill: BillListVM }) {
  return (
    <span className="flex min-h-15.5 w-full items-center gap-3 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col gap-0.75">
        <span className="line-clamp-2 break-words text-body/tight font-semibold text-text-soft">
          {bill.name}
        </span>
        <span className="text-meta font-medium text-text-muted">
          {TAGIHAN_COPY.everyMonth(bill.dayOfMonth)}
        </span>
      </span>
      <span className="whitespace-nowrap text-text-soft">
        <MoneyText value={bill.amount} />
      </span>
    </span>
  );
}
