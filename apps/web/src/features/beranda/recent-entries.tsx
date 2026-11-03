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
import type { BerandaContext } from './context';
import { RecentEntriesView, type RecentRow } from './recent-entries-view';

/** Pembungkus prototipe: 5 entri terbaru dari store demo. */
export function RecentEntries({
  state,
  ruang,
  today,
  entryHref,
  listHref,
}: BerandaContext & { entryHref: (id: string) => Route; listHref: Route }) {
  const accounts = new Map(state.accounts.map((a) => [a.id, a.name]));
  const rows: RecentRow[] = groupByDay(
    state.entries.filter((e) => e.ruang === ruang),
    today,
  )
    .flatMap((g) => g.items)
    .slice(0, 5)
    .map((e) => {
      const { value, kind } = signedAmount(e);
      return {
        id: e.id,
        href: entryHref(e.id),
        iconName: entryCategoryName(state, e),
        entryKind: e.kind,
        label: entryTitle(state, e),
        meta: `${entryKindLabel(state, e)} · ${accounts.get(e.accountId) ?? ''} · ${dayLabel(e.occurredOn, today)}`,
        value,
        kind,
      };
    });
  return <RecentEntriesView rows={rows} listHref={listHref} />;
}
