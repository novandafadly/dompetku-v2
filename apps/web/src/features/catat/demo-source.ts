import { balances, suggestCategories } from '@dompetku/demo-data';
import type { Account, Category, DemoState, DemoStore, Entry, Ruang } from '@dompetku/demo-data';
import type { AccountVM, CategoryVM } from '@/features/ledger/types';
import { savedToast } from './saved-toast';
import type { CatatOptions, CatatSource, SaveOutcome } from './source';

const RUANG_LABEL: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

function accountVM(a: Account, balance: number): AccountVM {
  return {
    id: a.id,
    name: a.name,
    pocket: a.pocket,
    walletType: a.walletType,
    openedOn: a.openedOn,
    archived: false,
    balance,
  };
}

function categoryVM(c: Category): CategoryVM {
  return {
    id: c.id,
    parentId: c.parentId,
    name: c.name,
    type: c.type,
    icon: c.icon,
    archived: false,
  };
}

/** Dompet operasional dengan entri hidup terbaru; lalu operasional pertama; lalu dompet pertama. */
function defaultAccountId(state: DemoState, accounts: Account[]): string {
  const operasional = accounts.filter((a) => a.pocket === 'operasional');
  const ids = new Set(operasional.map((a) => a.id));
  let latest: Entry | undefined;
  for (const e of state.entries) {
    if (e.voidedAt !== undefined || !ids.has(e.accountId)) continue;
    if (latest === undefined || e.createdAt > latest.createdAt) latest = e;
  }
  return latest?.accountId ?? operasional[0]?.id ?? accounts[0]?.id ?? '';
}

/**
 * Sumber prototipe: perilaku lama sheet Catat di atas store demo, sinkron (opsi dan chip) atau
 * dibungkus `Promise.resolve` (simpan, urungkan). Lemparan store = koneksi putus (`network`).
 */
export function demoCatatSource(state: DemoState, store: DemoStore): CatatSource {
  return {
    ruangLabel: RUANG_LABEL,
    options(ruang): CatatOptions {
      const accounts = state.accounts.filter((a) => a.ruang === ruang);
      const bal = balances(state, ruang);
      return {
        accounts: accounts.map((a) => accountVM(a, bal.get(a.id) ?? 0)),
        categories: state.categories.filter((c) => c.ruang === ruang).map(categoryVM),
        defaultAccountId: defaultAccountId(state, accounts),
      };
    },
    chips(ruang, type, hour) {
      return suggestCategories(state, ruang, { hourWIB: hour, type }).map(categoryVM);
    },
    save(d): Promise<SaveOutcome> {
      if (d.amount === null)
        return Promise.resolve({ ok: false, code: 'invalid', field: 'amount' });
      const base = {
        ruang: d.ruang,
        kind: d.type,
        occurredOn: d.date,
        createdBy: state.members[0]?.id ?? '',
        accountId: d.accountId,
        amount: d.amount,
        clientId: d.clientId,
        ...(d.description === undefined ? {} : { description: d.description }),
      };
      const input =
        d.type === 'transfer'
          ? { ...base, counterAccountId: d.counterAccountId ?? '' }
          : { ...base, categoryId: d.categoryId ?? '' };
      try {
        const replayed = store.getState().entries.some((e) => e.clientId === d.clientId);
        const entry = store.addEntry(input);
        const name = (id: string | undefined) =>
          store.getState().accounts.find((a) => a.id === id)?.name ?? '';
        return Promise.resolve({
          ok: true,
          entryId: entry.id,
          version: 1,
          replayed,
          toast: savedToast(
            RUANG_LABEL[d.ruang],
            entry.amount,
            d.type,
            name(entry.accountId),
            name(entry.counterAccountId),
          ),
        });
      } catch {
        // Store demo sinkron; kegagalan di sini mewakili koneksi putus. Isian tetap utuh.
        return Promise.resolve({ ok: false, code: 'network' });
      }
    },
    undo({ entryId }) {
      store.voidEntry(entryId);
      return Promise.resolve(true);
    },
  };
}
