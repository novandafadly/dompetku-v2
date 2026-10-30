'use client';

import { WarningIcon } from '@phosphor-icons/react';
import { addDays, dayLabel, daysInclusive } from '@dompetku/domain';
import { MoneyText } from '@/components/ui/money-text';
import type { BerandaContext } from './context';
import { BerandaSection, Row } from './section';

export function BillsSoon({ state, ruang, today }: BerandaContext) {
  const limit = addDays(today, 7);
  const bills = state.bills
    .filter((b) => b.ruang === ruang && !b.posted && b.dueOn <= limit)
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));

  return (
    <BerandaSection title="Tagihan 7 hari">
      {bills.length === 0 ? (
        <p className="text-base text-text-muted">Tidak ada tagihan dalam 7 hari ke depan.</p>
      ) : (
        <ul>
          {bills.map((b) => {
            const overdue = b.dueOn < today;
            return (
              <Row key={b.id}>
                <div className="min-w-0">
                  <p className="text-base break-words text-text">{b.name}</p>
                  {overdue ? (
                    <p className="flex items-center gap-1 text-sm text-danger">
                      <WarningIcon size={16} weight="fill" aria-hidden="true" />
                      <span>{`Lewat ${String(daysInclusive(b.dueOn, today) - 1)} hari`}</span>
                    </p>
                  ) : (
                    <p className="text-sm text-text-muted">{dayLabel(b.dueOn, today)}</p>
                  )}
                </div>
                <MoneyText value={b.amount} />
              </Row>
            );
          })}
        </ul>
      )}
    </BerandaSection>
  );
}
