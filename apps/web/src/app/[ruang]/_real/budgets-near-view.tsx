import Link from 'next/link';
import { GaugeIcon } from '@/components/ui/icons/gauge';
import { EmptyLine, ListCard } from '@/components/ui/list-card';
import { focusRing, rowDivider } from '@/components/ui/styles';
import { CardError } from '@/features/bersama/card-error';
import type { Ruang } from '@/features/ledger/types';
import { RENCANA_COPY } from '@/features/rencana/copy';
import { BudgetItemView } from '@/features/rencana/budget-row-view';
import { buildHref } from '@/features/shell/hrefs';
import type { BerandaBudgetsVM } from '@/server/ledger/beranda';
import { rencanaBagianHref } from './rencana-link';

/** Baris maksimum di Beranda; sisanya di `Semua` (S9-BR2). */
const MAX_ROWS = 5;

/**
 * Kartu `Anggaran hampir habis` mode nyata (S9-BR2): anggaran dengan pct ≥ 80 (loader). Server
 * Component, tanpa `'use client'` dan tanpa demo; `BudgetsNearLimit` prototipe tidak dipakai.
 * Baris hanya baca (tanpa caret dan tombol); mengatur dari Rencana.
 */
export function BudgetsNearCard({
  ruang,
  query,
  data,
}: {
  ruang: Ruang;
  query: string;
  data: BerandaBudgetsVM | 'error';
}) {
  const icon = <GaugeIcon size={18} />;
  if (data === 'error') {
    return (
      <ListCard title="Anggaran hampir habis" icon={icon}>
        <CardError
          message="Anggaran belum bisa dimuat."
          retryHref={buildHref(ruang, 'beranda', query)}
        />
      </ListCard>
    );
  }
  const href = rencanaBagianHref(ruang, 'anggaran', query);
  if (data.items.length === 0) {
    return (
      <ListCard title="Anggaran hampir habis" icon={icon}>
        {data.hasBudgets ? (
          <EmptyLine>Belum ada anggaran yang mendekati batas.</EmptyLine>
        ) : (
          <>
            <EmptyLine>Belum ada anggaran.</EmptyLine>
            <Link
              href={href}
              className={`-mt-2 mb-1 inline-flex min-h-11 items-center self-start rounded-md px-2 text-meta font-bold text-accent-text hover-pointer:underline ${focusRing}`}
            >
              {RENCANA_COPY.set}
            </Link>
          </>
        )}
      </ListCard>
    );
  }
  return (
    <ListCard
      title="Anggaran hampir habis"
      icon={icon}
      link={{ href, label: 'Semua', srLabel: 'anggaran' }}
    >
      <ul>
        {data.items.slice(0, MAX_ROWS).map((b) => (
          <li key={b.categoryId} className={`py-3 ${rowDivider}`}>
            <BudgetItemView row={b} caret={false} />
          </li>
        ))}
      </ul>
    </ListCard>
  );
}
