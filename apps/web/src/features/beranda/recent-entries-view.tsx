'use client';

import type { Rupiah } from '@dompetku/domain';
import type { Route } from 'next';
import { CategoryIcon } from '@/components/ui/category-icon';
import { ClockCounterClockwiseIcon } from '@/components/ui/icons/clock-counter-clockwise';
import { EmptyLine, ListCard } from '@/components/ui/list-card';
import { TxRow } from '@/components/ui/rows';

/** Satu baris "Terakhir", sudah dirangkai pembungkus (selector demo atau presenter VM). */
export interface RecentRow {
  id: string;
  href: Route;
  /** Nama kategori untuk ikon (bisa kosong) dan jenis entri. */
  iconName: string | undefined;
  entryKind: string;
  label: string;
  meta: string;
  value: Rupiah;
  kind: 'income' | 'expense' | 'neutral';
}

export function RecentEntriesView({ rows, listHref }: { rows: RecentRow[]; listHref: Route }) {
  return (
    <ListCard
      title="Terakhir"
      icon={<ClockCounterClockwiseIcon size={18} />}
      {...(rows.length === 0
        ? {}
        : { link: { href: listHref, label: 'Semua', srLabel: 'transaksi' } })}
    >
      {rows.length === 0 ? (
        <EmptyLine>Belum ada transaksi. Catatan pertamamu akan muncul di sini.</EmptyLine>
      ) : (
        <ul>
          {rows.map((r) => (
            <TxRow
              key={r.id}
              href={r.href}
              icon={<CategoryIcon name={r.iconName} kind={r.entryKind} size={20} />}
              label={r.label}
              meta={r.meta}
              value={r.value}
              kind={r.kind}
            />
          ))}
        </ul>
      )}
    </ListCard>
  );
}
