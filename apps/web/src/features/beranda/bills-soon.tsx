'use client';

import { addDays, dayOfMonth, dueLabel, weekdayShort } from '@dompetku/domain';
import { CalendarDotsIcon } from '@/components/ui/icons/calendar-dots';
import { EmptyLine, ListCard } from '@/components/ui/list-card';
import { BillRow } from '@/components/ui/rows';
import type { BerandaContext } from './context';

export function BillsSoon({ state, ruang, today }: BerandaContext) {
  const limit = addDays(today, 7);
  const bills = state.bills
    .filter((b) => b.ruang === ruang && !b.posted && b.dueOn <= limit)
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));

  return (
    <ListCard title="Tagihan 7 hari" icon={<CalendarDotsIcon size={18} />}>
      {bills.length === 0 ? (
        <EmptyLine>Tidak ada tagihan dalam 7 hari ke depan.</EmptyLine>
      ) : (
        <ul>
          {bills.map((b) => (
            <BillRow
              key={b.id}
              weekday={weekdayShort(b.dueOn)}
              day={dayOfMonth(b.dueOn)}
              name={b.name}
              due={dueLabel(b.dueOn, today)}
              overdue={b.dueOn < today}
              amount={b.amount}
            />
          ))}
        </ul>
      )}
    </ListCard>
  );
}
