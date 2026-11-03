import type { Rupiah } from '@dompetku/domain';
import { ClockIcon } from './icons/clock';
import { WarningCircleIcon } from './icons/warning-circle';
import { MoneyText } from './money-text';
import { rowTitle } from './row-text';
import { rowDivider, tile } from './styles';

// Satu berkas per jenis baris: rute hanya memuat baris yang dipakainya (ADR 0002).

/** Tagihan: ubin tanggal 44 (hari kapital + tanggal), nama, jatuh tempo, nominal. Terlambat = danger + ikon. */
export function BillRow({
  weekday,
  day,
  name,
  due,
  overdue,
  amount,
}: {
  weekday: string;
  day: number;
  name: string;
  due: string;
  overdue: boolean;
  amount: Rupiah;
}) {
  return (
    <li className={`flex min-h-15.5 items-center gap-3 ${rowDivider}`}>
      <span
        aria-hidden="true"
        className={`size-11 flex-col gap-0.5 ${tile} ${overdue ? 'bg-danger-tint' : ''}`}
      >
        <span
          className={`text-tiny font-bold tracking-eyebrow uppercase ${overdue ? 'text-danger' : 'text-text-muted'}`}
        >
          {weekday}
        </span>
        <span
          className={`text-subheading/none font-extrabold ${overdue ? 'text-danger' : 'text-text'}`}
        >
          {day}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.75">
        <span className={rowTitle}>{name}</span>
        <span
          className={`flex items-center gap-1 text-meta ${overdue ? 'font-semibold text-danger' : 'font-medium text-text-muted'}`}
        >
          {overdue ? (
            <WarningCircleIcon size={14} weight="fill" className="shrink-0" />
          ) : (
            <ClockIcon size={14} className="shrink-0" />
          )}
          {due}
        </span>
      </span>
      <MoneyText value={amount} />
    </li>
  );
}
