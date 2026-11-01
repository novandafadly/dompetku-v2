import { createSeed, entryKindLabel, entryTitle, signedAmount } from '@dompetku/demo-data';
import type { DemoState, Entry } from '@dompetku/demo-data';
import { describe, expect, it } from 'vitest';
import { entryKindLabelVM, entryTitleVM, signedAmountVM } from './present';
import type { EntryVM } from './types';

const state: DemoState = createSeed({ today: '2026-10-17', variant: 'full' });

function toVM(s: DemoState, e: Entry): EntryVM {
  const acc = s.accounts.find((a) => a.id === e.accountId);
  const counter = s.accounts.find((a) => a.id === e.counterAccountId);
  const cat = s.categories.find((c) => c.id === e.categoryId);
  const by = s.members.find((m) => m.id === e.createdBy);
  return {
    id: e.id,
    version: 1,
    kind: e.kind,
    occurredOn: e.occurredOn,
    createdAt: e.createdAt,
    createdBy: { id: e.createdBy, name: by?.name ?? '?', initial: by?.initial ?? '?' },
    accountId: e.accountId,
    accountName: acc?.name ?? '',
    amount: e.amount,
    ...(e.counterAccountId !== undefined && { counterAccountId: e.counterAccountId }),
    ...(counter && { counterAccountName: counter.name }),
    ...(e.categoryId !== undefined && { categoryId: e.categoryId }),
    ...(cat && { categoryName: cat.name, categoryIcon: cat.icon }),
    ...(e.description !== undefined && { description: e.description }),
    ...(e.voidedAt !== undefined && { voidedAt: e.voidedAt }),
    ...(e.direction !== undefined && { direction: e.direction }),
    ...(e.sharedNote !== undefined && { sharedNote: e.sharedNote }),
  };
}

describe('presenter setara selector demo', () => {
  it('seed punya entri', () => {
    expect(state.entries.length).toBeGreaterThan(10);
  });
  for (const e of state.entries) {
    it(`entri ${e.id} (${e.kind})`, () => {
      const vm = toVM(state, e);
      expect(entryTitleVM(vm)).toBe(entryTitle(state, e));
      expect(entryKindLabelVM(vm)).toBe(entryKindLabel(state, e));
      expect(signedAmountVM(vm)).toEqual(signedAmount(e));
    });
  }

  it('adjustment: Cocokkan saldo, netral', () => {
    const vm: EntryVM = {
      id: 'adj-1',
      version: 1,
      kind: 'adjustment',
      occurredOn: '2026-10-17',
      createdAt: '2026-10-17T10:00:00+07:00',
      createdBy: { id: 'm1', name: 'Novanda', initial: 'N' },
      accountId: 'a1',
      accountName: 'Kas',
      amount: 5000,
    };
    expect(entryTitleVM(vm)).toBe('Cocokkan saldo');
    expect(entryKindLabelVM(vm)).toBe('Cocokkan saldo');
    expect(signedAmountVM(vm)).toEqual({ value: 5000, kind: 'neutral' });
  });
});
