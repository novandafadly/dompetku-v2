'use client';

import { groupByDay } from '@dompetku/demo-data';
import type { DemoState, Entry } from '@dompetku/demo-data';
import { dayLabel } from '@dompetku/domain';
import { MoneyText, type MoneyKind } from '@/components/ui/money-text';
import type { BerandaContext } from './context';
import { BerandaSection, Row } from './section';

function titleOf(state: DemoState, e: Entry): string {
  switch (e.kind) {
    case 'opening_balance':
      return 'Saldo awal';
    case 'transfer':
      return e.description ?? 'Pindah dompet';
    case 'space_transfer':
      return e.sharedNote ?? (e.direction === 'in' ? 'Setoran dari Pribadi' : 'Setoran ke Bersama');
    default:
      return (
        e.description ??
        state.categories.find((c) => c.id === e.categoryId)?.name ??
        'Tanpa kategori'
      );
  }
}

function signed(e: Entry): { value: number; kind: MoneyKind } {
  switch (e.kind) {
    case 'income':
      return { value: e.amount, kind: 'income' };
    case 'expense':
      return { value: -e.amount, kind: 'expense' };
    case 'space_transfer':
      return { value: e.direction === 'in' ? e.amount : -e.amount, kind: 'neutral' };
    default:
      return { value: e.amount, kind: 'neutral' };
  }
}

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
        <p className="text-base text-text-muted">Belum ada transaksi.</p>
      ) : (
        <ul>
          {recent.map((e) => {
            const { value, kind } = signed(e);
            return (
              <Row key={e.id}>
                <div className="min-w-0">
                  <p className="text-base break-words text-text">{titleOf(state, e)}</p>
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
