'use client';

import {
  entryCategoryName,
  entryKindLabel,
  entryTitle,
  groupByDay,
  signedAmount,
} from '@dompetku/demo-data';
import { dayLabel } from '@dompetku/domain';
import type { Route } from 'next';
import { CategoryIcon } from '@/components/ui/category-icon';
import { ClockCounterClockwiseIcon } from '@/components/ui/icons/clock-counter-clockwise';
import { EmptyLine, ListCard } from '@/components/ui/list-card';
import { TxRow } from '@/components/ui/rows';
import type { BerandaContext } from './context';

export function RecentEntries({
  state,
  ruang,
  today,
  entryHref,
  listHref,
}: BerandaContext & { entryHref: (id: string) => Route; listHref: Route }) {
  const accounts = new Map(state.accounts.map((a) => [a.id, a.name]));
  const recent = groupByDay(
    state.entries.filter((e) => e.ruang === ruang),
    today,
  )
    .flatMap((g) => g.items)
    .slice(0, 5);

  return (
    <ListCard
      title="Terakhir"
      icon={<ClockCounterClockwiseIcon size={18} />}
      {...(recent.length === 0
        ? {}
        : { link: { href: listHref, label: 'Semua', srLabel: 'transaksi' } })}
    >
      {recent.length === 0 ? (
        <EmptyLine>Belum ada transaksi. Catatan pertamamu akan muncul di sini.</EmptyLine>
      ) : (
        <ul>
          {recent.map((e) => {
            const { value, kind } = signedAmount(e);
            return (
              <TxRow
                key={e.id}
                href={entryHref(e.id)}
                icon={<CategoryIcon name={entryCategoryName(state, e)} kind={e.kind} size={20} />}
                label={entryTitle(state, e)}
                meta={`${entryKindLabel(state, e)} · ${accounts.get(e.accountId) ?? ''} · ${dayLabel(e.occurredOn, today)}`}
                value={value}
                kind={kind}
              />
            );
          })}
        </ul>
      )}
    </ListCard>
  );
}
