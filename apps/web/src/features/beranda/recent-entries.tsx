'use client';

import { entryTitle, groupByDay, signedAmount } from '@dompetku/demo-data';
import { dayLabel } from '@dompetku/domain';
import { MoneyText } from '@/components/ui/money-text';
import type { BerandaContext } from './context';
import { BerandaSection, EmptyLine, Row } from './section';

export function RecentEntries({ state, ruang, today }: BerandaContext) {
  const accounts = new Map(state.accounts.map((a) => [a.id, a.name]));
  const recent = groupByDay(
    state.entries.filter((e) => e.ruang === ruang),
    today,
  )
    .flatMap((g) => g.items)
    .slice(0, 5);

  return (
    <BerandaSection title="Terakhir">
      {recent.length === 0 ? (
        <EmptyLine>Belum ada transaksi.</EmptyLine>
      ) : (
        <ul>
          {recent.map((e) => {
            const { value, kind } = signedAmount(e);
            return (
              <Row key={e.id}>
                <div className="min-w-0">
                  <p className="text-base break-words text-text">{entryTitle(state, e)}</p>
                  <p className="text-sm text-text-muted">
                    {dayLabel(e.occurredOn, today)} · {accounts.get(e.accountId) ?? ''}
                  </p>
                </div>
                <MoneyText value={value} kind={kind} />
              </Row>
            );
          })}
        </ul>
      )}
    </BerandaSection>
  );
}
