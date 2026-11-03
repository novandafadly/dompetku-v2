import type { DemoState, Entry } from '@dompetku/demo-data';
import type { EntryVM } from '@/features/ledger/types';

/** Entri demo → `EntryVM` (pembungkus demo merender view VM yang sama dengan mode nyata). */
export function entryToVM(state: DemoState, e: Entry): EntryVM {
  const name = (id: string | undefined) => state.accounts.find((a) => a.id === id)?.name ?? '';
  const cat = state.categories.find((c) => c.id === e.categoryId);
  const by = state.members.find((m) => m.id === e.createdBy);
  const vm: EntryVM = {
    id: e.id,
    version: 1,
    kind: e.kind,
    occurredOn: e.occurredOn,
    createdAt: e.createdAt,
    createdBy: { id: e.createdBy, name: by?.name ?? '', initial: by?.initial ?? '' },
    accountId: e.accountId,
    accountName: name(e.accountId),
    amount: e.amount,
  };
  if (e.counterAccountId !== undefined) {
    vm.counterAccountId = e.counterAccountId;
    vm.counterAccountName = name(e.counterAccountId);
  }
  if (cat) {
    vm.categoryId = cat.id;
    vm.categoryName = cat.name;
    vm.categoryIcon = cat.icon;
  }
  if (e.description !== undefined) vm.description = e.description;
  if (e.voidedAt !== undefined) vm.voidedAt = e.voidedAt;
  if (e.direction !== undefined) vm.direction = e.direction;
  if (e.sharedNote !== undefined) vm.sharedNote = e.sharedNote;
  return vm;
}
