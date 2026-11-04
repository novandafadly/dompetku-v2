import { dayLabel, formatRupiah, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { Route } from 'next';
import { ClockIcon } from '@/components/ui/icons/clock';
import { HandCoinsIcon } from '@/components/ui/icons/hand-coins';
import { ListCard } from '@/components/ui/list-card';
import { MoneyText } from '@/components/ui/money-text';
import { TxRow } from '@/components/ui/rows';
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

export function waitingItems(
  rows: ReimbursableVM[],
  accounts: AccountVM[],
  today: IsoDate,
  entryHref: (id: string) => Route,
): WaitingItem[] {
  return rows.map((r) => ({
    id: r.entryId,
    href: entryHref(r.entryId),
    label: r.description ?? 'Talangan kantor',
    meta: `Talangan · ${accounts.find((a) => a.id === r.accountId)?.name ?? 'Dompet'} · ${dayLabel(r.occurredOn, today)}`,
    remaining: r.remaining,
    total: r.amount,
    partial: r.reimbursed > 0,
  }));
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
          <TxRow
            key={i.id}
            href={i.href}
            icon={<HandCoinsIcon size={20} />}
            label={i.label}
            meta={i.meta}
            status={
              i.partial ? (
                <span className="flex items-center gap-1.5 text-meta font-semibold text-warning">
                  <ClockIcon size={14} className="shrink-0" />
                  {`sisa ${formatRupiah(i.remaining)} dari ${formatRupiah(i.total)}`}
                </span>
              ) : undefined
            }
            value={i.remaining}
            kind="neutral"
          />
        ))}
      </ul>
    </ListCard>
  );
}
