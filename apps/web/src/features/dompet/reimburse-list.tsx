import { dayLabel, formatRupiah, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { Route } from 'next';
import Link from 'next/link';
import { ClockIcon } from '@/components/ui/icons/clock';
import { HandCoinsIcon } from '@/components/ui/icons/hand-coins';
import { ListCard } from '@/components/ui/list-card';
import { MoneyText } from '@/components/ui/money-text';
import { rowTitle } from '@/components/ui/row-text';
import { focusRing, rowDivider, tile } from '@/components/ui/styles';
import type { AccountVM, ReimbursableVM } from '@/features/ledger/types';

/**
 * Menunggu reimburse (S7-W4): talangan Pribadi yang belum diganti penuh, di halaman Dompet. Server
 * Component murni; datanya tidak pernah dimuat di Bersama (page tidak memanggil loader-nya).
 */

/** Baris yang ditampilkan; lebihnya tidak ditautkan karena Transaksi nyata belum punya filter talangan. */
export const WAITING_MAX = 5;

export interface WaitingItem {
  id: string;
  href: Route;
  label: string;
  meta: string;
  /** Sisa yang belum diganti (nominal baris). */
  remaining: Rupiah;
  total: Rupiah;
  /** Sudah diganti sebagian: baris memuat status `sisa … dari …`. */
  partial: boolean;
}

/** `accounts` = dompet aktif dan terarsip (talangan lama bisa berasal dari dompet yang sudah diarsipkan). */
export function waitingItems(
  rows: ReimbursableVM[],
  accounts: AccountVM[],
  today: IsoDate,
  entryHref: (id: string) => Route,
): WaitingItem[] {
  return rows.map((r) => ({
    id: r.entryId,
    href: entryHref(r.entryId),
    label: r.description ?? r.categoryName ?? 'Talangan',
    meta: `Talangan · ${accounts.find((a) => a.id === r.accountId)?.name ?? 'Dompet'} · ${dayLabel(r.occurredOn, today)}`,
    remaining: r.remaining,
    total: r.amount,
    partial: r.reimbursed > 0,
  }));
}

/**
 * Baris HP (< 600): keterangan + meta penuh lebar (meta boleh turun baris), nominal di baris
 * sendiri sejajar kolom teks (ubin 40 + jarak 12 = `ml-13`, seperti TxRow < 360); tablet ke atas
 * satu baris.
 */
function WaitingRow({ item }: { item: WaitingItem }) {
  return (
    <li className={rowDivider}>
      <Link
        href={item.href}
        className={`-mx-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 hover-pointer:bg-hover active:bg-hover ${focusRing}`}
      >
        <span className="flex min-w-0 basis-full items-start gap-3 tablet:grow tablet:basis-0">
          <span aria-hidden="true" className={`size-10 ${tile}`}>
            <HandCoinsIcon size={20} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.75">
            <span className={rowTitle}>{item.label}</span>
            <span className="block text-meta font-medium break-words text-text-muted">
              {item.meta}
            </span>
            {item.partial ? (
              <span className="flex items-start gap-1.5 text-meta font-semibold text-warning">
                <ClockIcon size={14} className="mt-0.5 shrink-0" />
                {`sisa ${formatRupiah(item.remaining)} dari ${formatRupiah(item.total)}`}
              </span>
            ) : null}
          </span>
        </span>{' '}
        <MoneyText value={item.remaining} kind="neutral" className="ml-13 shrink-0 tablet:ml-0" />
      </Link>
    </li>
  );
}

export function WaitingReimburseList({ items, total }: { items: WaitingItem[]; total: Rupiah }) {
  if (items.length === 0) return null;
  return (
    <ListCard
      title="Menunggu reimburse"
      icon={<ClockIcon size={18} />}
      aside={
        <MoneyText value={total} size="inherit" className="text-label font-bold text-text-soft" />
      }
    >
      <ul aria-label="Talangan menunggu reimburse">
        {items.slice(0, WAITING_MAX).map((i) => (
          <WaitingRow key={i.id} item={i} />
        ))}
      </ul>
    </ListCard>
  );
}
