import type { Rupiah } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CaretRightIcon } from './icons/caret-right';
import { ClockIcon } from './icons/clock';
import { WarningCircleIcon } from './icons/warning-circle';
import { WarningIcon } from './icons/warning';
import { WarningOctagonIcon } from './icons/warning-octagon';
import { MoneyText, type MoneyKind } from './money-text';
import { rowDivider, rowLink, tile } from './styles';

const title = 'block truncate text-body/tight font-semibold text-text';
const sub = 'block truncate text-meta font-medium text-text-muted';

/** Baris transaksi (≥ 62): ubin ikon kategori, keterangan (ellipsis), sub, nominal. Seluruh baris tautan ke detail. */
export function TxRow({
  href,
  icon,
  label,
  meta,
  status,
  value,
  kind,
}: {
  href: Route;
  icon: ReactNode;
  label: string;
  meta?: string;
  /** Status tambahan (ikon + teks), mis. Menunggu reimburse. */
  status?: ReactNode;
  value: Rupiah;
  kind: MoneyKind;
}) {
  return (
    <li className={rowDivider}>
      <Link href={href} className={rowLink}>
        <span aria-hidden="true" className={`size-10 ${tile}`}>
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.75">
          <span className={title}>{label}</span>
          {meta === undefined ? null : <span className={sub}>{meta}</span>}
          {status}
        </span>
        {/* Spasi di DOM agar teks baris terbaca utuh oleh pembaca layar. */}{' '}
        <MoneyText value={value} kind={kind} />
      </Link>
    </li>
  );
}

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
        <span className={title}>{name}</span>
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

/** Aktivitas Bersama: avatar inisial 36 (N netral, F violet), kalimat, waktu, nominal. */
export function ActivityRow({
  initial,
  name,
  text,
  time,
  amount,
}: {
  initial: string;
  name: string;
  text: string;
  time: string;
  amount?: Rupiah | undefined;
}) {
  return (
    <li className={`flex min-h-15.5 items-center gap-3 py-2 ${rowDivider}`}>
      <span
        data-initial=""
        aria-hidden="true"
        className={`flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-label font-extrabold ${
          initial === 'F' ? 'bg-bersama-tint text-bersama' : 'bg-surface-3 text-text'
        }`}
      >
        {initial}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-label font-medium break-words text-text">
          <span className="font-bold">{name}</span> · {text}
        </span>
        <span className="text-caption font-medium text-text-muted">{time}</span>
      </span>
      {amount !== undefined ? <MoneyText value={amount} /> : null}
    </li>
  );
}

/** Dompet: ubin ikon tipe, nama, tipe, saldo, caret; seluruh baris tautan ke riwayat. */
export function WalletRow({
  href,
  icon,
  name,
  type,
  balance,
}: {
  href: Route;
  icon: ReactNode;
  name: string;
  type: string;
  balance: Rupiah;
}) {
  return (
    <li className={rowDivider}>
      <Link href={href} className={rowLink}>
        <span aria-hidden="true" className={`size-10 ${tile}`}>
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.75">
          <span className="block text-body/tight font-semibold break-words text-text">{name}</span>
          <span className={sub}>{type}</span>
        </span>{' '}
        <MoneyText value={balance} />
        <CaretRightIcon size={16} weight="bold" className="shrink-0 text-text-muted" />
      </Link>
    </li>
  );
}
