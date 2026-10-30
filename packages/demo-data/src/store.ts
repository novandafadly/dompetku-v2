import { nowIsoWIB } from '@dompetku/domain';
import type { Rupiah } from '@dompetku/domain';
import type { Account, DemoState, Entry } from './types';

export interface DemoStore {
  getState(): DemoState;
  subscribe(fn: () => void): () => void;
  addEntry(e: Omit<Entry, 'id' | 'createdAt'>): Entry;
  voidEntry(id: string): void;
  restoreEntry(id: string): void;
  addAccount(a: Omit<Account, 'id'>, openingBalance: Rupiah): Account;
}

export interface DemoStoreOptions {
  clock?: () => string;
}

export function createDemoStore(seed: DemoState, opts: DemoStoreOptions = {}): DemoStore {
  const clock = opts.clock ?? (() => nowIsoWIB());
  let state = seed;
  const listeners = new Set<() => void>();

  const commit = (next: DemoState) => {
    state = next;
    for (const fn of [...listeners]) fn();
  };

  const linked = (id: string): Set<string> => {
    const ids = new Set([id]);
    const self = state.entries.find((e) => e.id === id);
    if (self?.linkId !== undefined) {
      for (const e of state.entries) if (e.linkId === self.linkId) ids.add(e.id);
    }
    return ids;
  };

  const nextEntryId = () => 'e' + String(state.entries.length + 1);

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    addEntry(e) {
      const entry: Entry = { ...e, id: nextEntryId(), createdAt: clock() };
      commit({ ...state, entries: [...state.entries, entry] });
      return entry;
    },
    voidEntry(id) {
      const at = clock();
      const ids = linked(id);
      if (!state.entries.some((e) => ids.has(e.id) && e.voidedAt === undefined)) return;
      commit({
        ...state,
        entries: state.entries.map((e) =>
          ids.has(e.id) && e.voidedAt === undefined ? { ...e, voidedAt: at } : e,
        ),
      });
    },
    restoreEntry(id) {
      const ids = linked(id);
      if (!state.entries.some((e) => ids.has(e.id) && e.voidedAt !== undefined)) return;
      commit({
        ...state,
        entries: state.entries.map((e) => {
          if (!ids.has(e.id) || e.voidedAt === undefined) return e;
          const restored = { ...e };
          delete restored.voidedAt;
          return restored;
        }),
      });
    },
    addAccount(a, openingBalance) {
      const account: Account = { ...a, id: 'acc-' + String(state.accounts.length + 1) };
      const entries = [...state.entries];
      if (openingBalance > 0) {
        entries.push({
          id: nextEntryId(),
          ruang: account.ruang,
          kind: 'opening_balance',
          occurredOn: account.openedOn,
          createdAt: clock(),
          createdBy: account.ownerId ?? state.members[0]?.id ?? '',
          accountId: account.id,
          amount: openingBalance,
        });
      }
      commit({ ...state, accounts: [...state.accounts, account], entries });
      return account;
    },
  };
}
