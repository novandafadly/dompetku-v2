import { addDays, dayLabel, daysInclusive, endOfMonth } from '@dompetku/domain';
import { describe, expect, it } from 'vitest';
import { createSeed } from './seed';
import {
  activityFeed,
  balances,
  budgetProgress,
  entryTitle,
  groupByDay,
  monthSummary,
  safeToSpend,
  signedAmount,
  suggestCategories,
} from './selectors';
import { createDemoStore } from './store';
import type { DemoState, Entry } from './types';

const TODAY = '2026-10-17';
const full = (): DemoState => createSeed({ today: TODAY, variant: 'full' });

function acc(state: DemoState, name: string) {
  const a = state.accounts.find((x) => x.name === name);
  if (!a) throw new Error(`no account ${name}`);
  return a;
}

function expected(state: DemoState, ruang: 'pribadi' | 'bersama'): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of state.accounts) if (a.ruang === ruang) m.set(a.id, 0);
  const add = (id: string, d: number) => {
    if (m.has(id)) m.set(id, (m.get(id) ?? 0) + d);
  };
  for (const e of state.entries) {
    if (e.voidedAt !== undefined) continue;
    if (e.kind === 'income' || e.kind === 'opening_balance') add(e.accountId, e.amount);
    else if (e.kind === 'expense') add(e.accountId, -e.amount);
    else if (e.kind === 'transfer') {
      add(e.accountId, -e.amount);
      if (e.counterAccountId) add(e.counterAccountId, e.amount);
    } else add(e.accountId, e.direction === 'in' ? e.amount : -e.amount);
  }
  return m;
}

describe('createSeed', () => {
  it('is deterministic', () => {
    expect(JSON.stringify(full())).toBe(JSON.stringify(full()));
  });

  it('empty variant has only members', () => {
    const s = createSeed({ today: TODAY, variant: 'empty' });
    expect(s.members.map((m) => m.name)).toEqual(['Novanda', 'Farida']);
    expect(s.accounts).toEqual([]);
    expect(s.entries).toEqual([]);
    expect(s.bills).toEqual([]);
    expect(s.budgets).toEqual([]);
  });

  it('is realistic: whole rupiah, +07:00 timestamps, ownership', () => {
    const s = full();
    const nov = s.members.find((m) => m.name === 'Novanda');
    for (const e of s.entries) {
      expect(Number.isSafeInteger(e.amount) && e.amount > 0).toBe(true);
      expect(e.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
    }
    for (const a of s.accounts) {
      expect(a.ownerId).toBe(a.ruang === 'pribadi' ? nov?.id : null);
    }
    expect(s.entries.filter((e) => e.reimbursable === true).length).toBeGreaterThanOrEqual(3);
    const soon = s.bills.filter(
      (b) => !b.posted && b.dueOn >= TODAY && b.dueOn <= addDays(TODAY, 7),
    );
    expect(soon.length).toBeGreaterThanOrEqual(2);
    const legs = s.entries.filter((e) => e.kind === 'space_transfer');
    expect(legs.filter((e) => e.direction === 'out').length).toBeGreaterThanOrEqual(3);
  });
});

describe('balances', () => {
  it('matches signed sum for both ruang, ignoring voided', () => {
    const s = full();
    const target = s.entries.find((e) => e.kind === 'expense' && e.ruang === 'pribadi');
    if (!target) throw new Error('no expense');
    const voided: DemoState = {
      ...s,
      entries: s.entries.map((e) =>
        e.id === target.id ? { ...e, voidedAt: '2026-10-17T10:00:00+07:00' } : e,
      ),
    };
    for (const st of [s, voided]) {
      for (const r of ['pribadi', 'bersama'] as const) {
        expect(balances(st, r)).toEqual(expected(st, r));
      }
    }
    const before = balances(s, 'pribadi').get(target.accountId) ?? 0;
    expect(balances(voided, 'pribadi').get(target.accountId)).toBe(before + target.amount);
  });

  it('new account without entries is 0, and only own ruang accounts appear', () => {
    const store = createDemoStore(full());
    const a = store.addAccount(
      {
        ruang: 'pribadi',
        ownerId: 'm-novanda',
        name: 'Dompet Baru',
        pocket: 'operasional',
        walletType: 'ewallet',
        openedOn: TODAY,
      },
      0,
    );
    const b = balances(store.getState(), 'pribadi');
    expect(b.get(a.id)).toBe(0);
    expect(b.has(acc(full(), 'Kas Rumah').id)).toBe(false);
  });

  it('applies transfer legs within one ruang', () => {
    const s = full();
    const bca = acc(s, 'BCA');
    const darurat = acc(s, 'Dana Darurat');
    const store = createDemoStore(s);
    const b0 = balances(store.getState(), 'pribadi');
    store.addEntry({
      ruang: 'pribadi',
      kind: 'transfer',
      occurredOn: TODAY,
      createdBy: bca.ownerId ?? '',
      accountId: bca.id,
      counterAccountId: darurat.id,
      amount: 250_000,
    });
    const b1 = balances(store.getState(), 'pribadi');
    expect((b1.get(bca.id) ?? 0) - (b0.get(bca.id) ?? 0)).toBe(-250_000);
    expect((b1.get(darurat.id) ?? 0) - (b0.get(darurat.id) ?? 0)).toBe(250_000);
  });
});

describe('safeToSpend', () => {
  it('follows the formula and excludes kantor/tabungan', () => {
    const s = full();
    const r = safeToSpend(s, 'pribadi', TODAY);
    const bal = balances(s, 'pribadi');
    const op = s.accounts
      .filter((a) => a.ruang === 'pribadi' && a.pocket === 'operasional')
      .reduce((n, a) => n + (bal.get(a.id) ?? 0), 0);
    expect(r.operasional).toBe(op);
    expect(r.total).toBe(r.operasional - r.billsUntilEom - r.budgetWajibRemaining);
    expect(r.daysLeft).toBe(15);
    expect(r.daysLeft).toBe(daysInclusive(TODAY, endOfMonth(TODAY)));
    expect(r.until).toBe('2026-10-31');
    expect(r.perDay).toBe(Math.floor(r.total / r.daysLeft));
    expect(r.total).toBeGreaterThan(1_000_000);
    expect(r.total).toBeLessThan(10_000_000);
    const kantor = acc(s, 'Kas Kantor');
    expect(op).not.toBe(op + (bal.get(kantor.id) ?? 0));
  });

  it('counts overdue and due-until-eom bills only, unposted', () => {
    const s = full();
    const r = safeToSpend(s, 'bersama', TODAY);
    const sum = s.bills
      .filter((b) => b.ruang === 'bersama' && !b.posted && b.dueOn <= '2026-10-31')
      .reduce((n, b) => n + b.amount, 0);
    expect(r.billsUntilEom).toBe(sum);
    expect(s.bills.some((b) => b.ruang === 'bersama' && !b.posted && b.dueOn < TODAY)).toBe(true);
  });

  it('keeps negative totals negative', () => {
    const s = full();
    const poor: DemoState = {
      ...s,
      bills: [
        ...s.bills,
        {
          id: 'bx',
          ruang: 'pribadi',
          name: 'Besar',
          amount: 900_000_000,
          dueOn: TODAY,
          posted: false,
        },
      ],
    };
    const r = safeToSpend(poor, 'pribadi', TODAY);
    expect(r.total).toBeLessThan(0);
    expect(r.perDay).toBe(Math.floor(r.total / 15));
  });

  it('wajib remaining uses spent this month, rolling children into parent', () => {
    const s = full();
    const month = '2026-10-01';
    const wajib = s.budgets.filter((b) => b.ruang === 'bersama' && b.wajib && b.month === month);
    expect(wajib.length).toBeGreaterThan(0);
    const spent = (catId: string) =>
      s.entries
        .filter(
          (e) =>
            e.ruang === 'bersama' &&
            e.kind === 'expense' &&
            e.voidedAt === undefined &&
            e.occurredOn.startsWith('2026-10') &&
            (e.categoryId === catId ||
              s.categories.find((c) => c.id === e.categoryId)?.parentId === catId),
        )
        .reduce((n, e) => n + e.amount, 0);
    const want = wajib.reduce((n, b) => n + Math.max(0, b.amount - spent(b.categoryId)), 0);
    expect(safeToSpend(s, 'bersama', TODAY).budgetWajibRemaining).toBe(want);
  });

  it('has a Bersama budget at least 80% used', () => {
    const s = full();
    const used = s.budgets
      .filter((b) => b.ruang === 'bersama' && b.month === '2026-10-01')
      .map((b) => {
        const spent = s.entries
          .filter(
            (e) =>
              e.ruang === 'bersama' &&
              e.kind === 'expense' &&
              e.occurredOn.startsWith('2026-10') &&
              (e.categoryId === b.categoryId ||
                s.categories.find((c) => c.id === e.categoryId)?.parentId === b.categoryId),
          )
          .reduce((n, e) => n + e.amount, 0);
        return spent / b.amount;
      });
    expect(Math.max(...used)).toBeGreaterThanOrEqual(0.8);
  });
});

describe('bill vs wajib budget', () => {
  it('never counts one obligation as both an unposted bill and a wajib budget', () => {
    const s = full();
    const wajib = new Set(
      s.budgets.filter((b) => b.wajib).map((b) => b.ruang + ':' + b.categoryId),
    );
    const unposted = s.bills.filter((b) => !b.posted);
    expect(unposted.length).toBeGreaterThan(0);
    for (const bill of unposted) {
      const paid = s.entries.filter((e) => e.ruang === bill.ruang && e.description === bill.name);
      expect(paid.length).toBeGreaterThan(0);
      for (const e of paid) expect(wajib.has(e.ruang + ':' + (e.categoryId ?? ''))).toBe(false);
    }
  });
});

describe('groupByDay', () => {
  it('sorts descending, nets income minus expense, labels via dayLabel', () => {
    const s = full();
    const groups = groupByDay(
      s.entries.filter((e) => e.ruang === 'pribadi'),
      TODAY,
    );
    const dates = groups.map((g) => g.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(new Set(dates).size).toBe(dates.length);
    for (const g of groups) {
      expect(g.label).toBe(dayLabel(g.date, TODAY));
      const net = g.items.reduce(
        (n, e) => n + (e.kind === 'income' ? e.amount : e.kind === 'expense' ? -e.amount : 0),
        0,
      );
      expect(g.net).toBe(net);
    }
  });

  it('excludes voided entries', () => {
    const e: Entry = {
      id: 'x',
      ruang: 'pribadi',
      kind: 'expense',
      occurredOn: TODAY,
      createdAt: '2026-10-17T10:00:00+07:00',
      createdBy: 'm',
      accountId: 'a',
      amount: 5000,
      voidedAt: '2026-10-17T11:00:00+07:00',
    };
    expect(groupByDay([e], TODAY)).toEqual([]);
  });
});

describe('space_transfer', () => {
  it('appears in both ruang, in-leg has no description', () => {
    const s = full();
    const out = s.entries.find((e) => e.kind === 'space_transfer' && e.direction === 'out');
    if (!out?.linkId) throw new Error('no out leg');
    const inn = s.entries.find(
      (e) => e.kind === 'space_transfer' && e.linkId === out.linkId && e.direction === 'in',
    );
    expect(out.ruang).toBe('pribadi');
    expect(inn?.ruang).toBe('bersama');
    expect(inn?.description).toBeUndefined();
    expect(inn?.amount).toBe(out.amount);
    expect(balances(s, 'bersama').has(inn?.accountId ?? '')).toBe(true);
    expect(balances(s, 'pribadi').has(inn?.accountId ?? '')).toBe(false);
  });
});

describe('activityFeed', () => {
  it('never includes pribadi entries, has both actors, sorted desc, limited', () => {
    const s = full();
    const feed = activityFeed(s, 200);
    const pribadiIds = new Set(s.entries.filter((e) => e.ruang === 'pribadi').map((e) => e.id));
    expect(feed.length).toBeGreaterThan(0);
    for (const a of feed) expect(pribadiIds.has(a.id.replace(/^act-/, ''))).toBe(false);
    expect(new Set(feed.map((a) => a.actor.name))).toEqual(new Set(['Novanda', 'Farida']));
    const ats = feed.map((a) => a.at);
    expect(ats).toEqual([...ats].sort().reverse());
    expect(activityFeed(s, 5)).toHaveLength(5);
  });
});

describe('suggestCategories', () => {
  it('returns up to 6 expense categories of the ruang', () => {
    const s = full();
    const out = suggestCategories(s, 'pribadi', { hourWIB: 12 });
    expect(out.length).toBe(6);
    for (const c of out) {
      expect(c.ruang).toBe('pribadi');
      expect(c.type).toBe('expense');
    }
    expect(suggestCategories(s, 'pribadi', { hourWIB: 12, amount: 40_000 })).toHaveLength(6);
  });

  it('type income lists the ruang income categories', () => {
    const s = full();
    const out = suggestCategories(s, 'pribadi', { hourWIB: 12, type: 'income' });
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      expect(c.ruang).toBe('pribadi');
      expect(c.type).toBe('income');
    }
  });

  it('prefers categories matching the hour', () => {
    const s = full();
    const noon = suggestCategories(s, 'pribadi', { hourWIB: 12 })[0];
    expect(noon?.name).toBe('Makan Siang & Minum');
  });
});

describe('seed', () => {
  it('latest live Pribadi operasional entry is on BCA (default Catat wallet)', () => {
    const s = full();
    const operasional = new Set(
      s.accounts
        .filter((a) => a.ruang === 'pribadi' && a.pocket === 'operasional')
        .map((a) => a.id),
    );
    const latest = s.entries
      .filter((e) => e.voidedAt === undefined && operasional.has(e.accountId))
      .reduce<Entry | undefined>(
        (m, e) => (m === undefined || e.createdAt > m.createdAt ? e : m),
        undefined,
      );
    expect(latest?.accountId).toBe('acc-bca');
  });
});

describe('store', () => {
  it('addEntry with a seen clientId returns the existing entry without duplicating', () => {
    const store = createDemoStore(full(), { clock: () => '2026-10-17T09:00:00+07:00' });
    const base = store.getState().entries[0];
    if (!base) throw new Error('no entry');
    const input = {
      ruang: 'pribadi' as const,
      kind: 'expense' as const,
      occurredOn: TODAY,
      createdBy: base.createdBy,
      accountId: base.accountId,
      amount: 35_000,
      clientId: 'c-1',
    };
    const count = store.getState().entries.length;
    const first = store.addEntry(input);
    const again = store.addEntry({ ...input, amount: 99_000 });
    expect(again).toBe(first);
    expect(store.getState().entries).toHaveLength(count + 1);
    expect(first.clientId).toBe('c-1');
    const other = store.addEntry({ ...input, clientId: 'c-2' });
    expect(other.id).not.toBe(first.id);
    expect(store.getState().entries).toHaveLength(count + 2);
  });

  it('voids and restores both legs of a space_transfer, and default clock is +07:00', () => {
    const store = createDemoStore(full());
    const leg = store.getState().entries.find((e) => e.kind === 'space_transfer');
    if (!leg) throw new Error('no leg');
    const legs = () => store.getState().entries.filter((e) => e.linkId === leg.linkId);
    expect(legs()).toHaveLength(2);
    store.voidEntry(leg.id);
    expect(legs().every((e) => e.voidedAt !== undefined)).toBe(true);
    expect(legs()[0]?.voidedAt).toMatch(/\+07:00$/);
    const other = legs().find((e) => e.id !== leg.id);
    store.restoreEntry(other?.id ?? '');
    expect(legs().every((e) => e.voidedAt === undefined)).toBe(true);
  });

  it('voidEntry then restoreEntry restores balances; updates are immutable', () => {
    const clock = () => '2026-10-17T09:00:00+07:00';
    const store = createDemoStore(full(), { clock });
    const s0 = store.getState();
    const target = s0.entries.find((e) => e.kind === 'expense' && e.ruang === 'pribadi');
    if (!target) throw new Error('no expense');
    const before = balances(s0, 'pribadi');
    store.voidEntry(target.id);
    const s1 = store.getState();
    expect(s1).not.toBe(s0);
    expect(s0.entries.find((e) => e.id === target.id)?.voidedAt).toBeUndefined();
    expect(s1.entries.find((e) => e.id === target.id)?.voidedAt).toBe(clock());
    expect(balances(s1, 'pribadi')).not.toEqual(before);
    store.restoreEntry(target.id);
    expect(balances(store.getState(), 'pribadi')).toEqual(before);
    expect(store.getState().entries.find((e) => e.id === target.id)?.voidedAt).toBeUndefined();
  });

  it('addEntry gives deterministic ids and clock createdAt; subscribe/unsubscribe', () => {
    const store = createDemoStore(createSeed({ today: TODAY, variant: 'full' }), {
      clock: () => '2026-10-17T09:00:00+07:00',
    });
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    const base = store.getState().entries[0];
    if (!base) throw new Error('no entry');
    const e1 = store.addEntry({
      ruang: 'pribadi',
      kind: 'expense',
      occurredOn: TODAY,
      createdBy: base.createdBy,
      accountId: base.accountId,
      amount: 10_000,
    });
    const e2 = store.addEntry({
      ruang: 'pribadi',
      kind: 'expense',
      occurredOn: TODAY,
      createdBy: base.createdBy,
      accountId: base.accountId,
      amount: 12_000,
    });
    expect(e1.id).not.toBe(e2.id);
    expect(e1.createdAt).toBe('2026-10-17T09:00:00+07:00');
    expect(calls).toBe(2);
    off();
    store.voidEntry(e1.id);
    expect(calls).toBe(2);
    const twin = createDemoStore(createSeed({ today: TODAY, variant: 'full' }), {
      clock: () => '2026-10-17T09:00:00+07:00',
    });
    const t1 = twin.addEntry({
      ruang: 'pribadi',
      kind: 'expense',
      occurredOn: TODAY,
      createdBy: base.createdBy,
      accountId: base.accountId,
      amount: 10_000,
    });
    expect(t1.id).toBe(e1.id);
  });

  it('addAccount creates opening_balance entry only when > 0', () => {
    const store = createDemoStore(createSeed({ today: TODAY, variant: 'full' }));
    const base = {
      ruang: 'bersama' as const,
      ownerId: null,
      pocket: 'tabungan' as const,
      walletType: 'bank' as const,
      openedOn: TODAY,
    };
    const n0 = store.getState().entries.length;
    const a = store.addAccount({ ...base, name: 'Nol' }, 0);
    expect(store.getState().entries).toHaveLength(n0);
    const b = store.addAccount({ ...base, name: 'Isi' }, 2_000_000);
    expect(store.getState().entries).toHaveLength(n0 + 1);
    expect(a.id).not.toBe(b.id);
    const bal = balances(store.getState(), 'bersama');
    expect(bal.get(a.id)).toBe(0);
    expect(bal.get(b.id)).toBe(2_000_000);
    const op = store.getState().entries.at(-1);
    expect(op?.kind).toBe('opening_balance');
    expect(op?.ruang).toBe('bersama');
  });
});

describe('budgetProgress', () => {
  it('rolls children into parent, floors pct, covers this month only', () => {
    const s = full();
    const rows = budgetProgress(s, 'bersama', TODAY);
    const month = '2026-10-01';
    const budgets = s.budgets.filter((b) => b.ruang === 'bersama' && b.month === month);
    expect(rows.map((r) => r.budget.categoryId).sort()).toEqual(
      budgets.map((b) => b.categoryId).sort(),
    );
    const parentOf = new Map(s.categories.map((c) => [c.id, c.parentId]));
    for (const r of rows) {
      let spent = 0;
      for (const e of s.entries) {
        if (e.voidedAt !== undefined || e.ruang !== 'bersama' || e.kind !== 'expense') continue;
        if (e.categoryId === undefined || !e.occurredOn.startsWith('2026-10')) continue;
        if ((parentOf.get(e.categoryId) ?? e.categoryId) === r.budget.categoryId) spent += e.amount;
      }
      expect(r.spent).toBe(spent);
      expect(r.pct).toBe(Math.floor((spent * 100) / r.budget.amount));
      expect(r.category.id).toBe(r.budget.categoryId);
    }
    expect(rows.some((r) => r.pct >= 80)).toBe(true);
  });

  it('excludes voided entries and other ruang', () => {
    const s = full();
    const before = budgetProgress(s, 'bersama', TODAY);
    const voided: DemoState = {
      ...s,
      entries: s.entries.map((e) =>
        e.ruang === 'bersama' && e.kind === 'expense'
          ? { ...e, voidedAt: '2026-10-17T10:00:00+07:00' }
          : e,
      ),
    };
    const after = budgetProgress(voided, 'bersama', TODAY);
    expect(after.every((r) => r.spent === 0 && r.pct === 0)).toBe(true);
    expect(before.some((r) => r.spent > 0)).toBe(true);
    expect(
      budgetProgress(createSeed({ today: TODAY, variant: 'empty' }), 'pribadi', TODAY),
    ).toEqual([]);
  });
});

describe('markNoSpendDay', () => {
  it('persists, is idempotent, per ruang, and notifies once', () => {
    const store = createDemoStore(full());
    expect(store.getState().noSpendDays).toEqual([]);
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.markNoSpendDay('pribadi', TODAY);
    store.markNoSpendDay('pribadi', TODAY);
    expect(store.getState().noSpendDays).toEqual([{ ruang: 'pribadi', date: TODAY }]);
    expect(calls).toBe(1);
    store.markNoSpendDay('bersama', TODAY);
    expect(store.getState().noSpendDays).toHaveLength(2);
  });
});

describe('budgetProgress Pribadi', () => {
  it('has a Pribadi budget at 80% or more but under 100% at the demo date', () => {
    const rows = budgetProgress(full(), 'pribadi', TODAY);
    expect(rows.some((r) => r.pct >= 80 && r.pct < 100)).toBe(true);
    const total = safeToSpend(full(), 'pribadi', TODAY).total;
    expect(total).toBeGreaterThan(1_000_000);
    expect(total).toBeLessThan(10_000_000);
  });
});

describe('activityFeed privacy', () => {
  it('never exposes Pribadi descriptions or Pribadi-only amounts, also after a space_transfer', () => {
    const store = createDemoStore(full());
    const s0 = store.getState();
    const out = acc(s0, 'BCA');
    const into = s0.accounts.find((a) => a.ruang === 'bersama' && a.pocket === 'operasional');
    if (!into) throw new Error('no bersama account');
    const novanda = s0.members[0];
    if (!novanda) throw new Error('no member');
    const secret = 'Rahasia pribadi 7777';
    const base = {
      kind: 'space_transfer' as const,
      occurredOn: TODAY,
      createdBy: novanda.id,
      amount: 777_000,
      linkId: 'link-priv',
    };
    store.addEntry({
      ...base,
      ruang: 'pribadi',
      accountId: out.id,
      direction: 'out',
      description: secret,
    });
    store.addEntry({
      ...base,
      ruang: 'bersama',
      accountId: into.id,
      direction: 'in',
    });
    const state = store.getState();
    const feed = JSON.stringify(activityFeed(state, 1000));
    const pribadi = state.entries.filter((e) => e.ruang === 'pribadi');
    const bersamaAmounts = new Set(
      state.entries.filter((e) => e.ruang === 'bersama').map((e) => e.amount),
    );
    for (const e of pribadi) {
      if (e.description !== undefined) expect(feed).not.toContain(e.description);
    }
    expect(feed).not.toContain(secret);
    for (const e of pribadi) {
      if (!bersamaAmounts.has(e.amount) && e.kind !== 'space_transfer') {
        expect(activityFeed(state, 1000).some((a) => a.amount === e.amount)).toBe(false);
      }
    }
    expect(feed).not.toContain(out.name);
  });
});

describe('monthSummary', () => {
  const base = {
    ruang: 'pribadi',
    createdAt: '2026-10-10T10:00:00+07:00',
    createdBy: 'm',
  } as const;
  const mk = (
    id: string,
    e: Partial<Entry> & Pick<Entry, 'kind' | 'amount' | 'accountId'>,
  ): Entry => ({
    ...base,
    id,
    occurredOn: '2026-10-10',
    ...e,
  });

  function stateWith(entries: Entry[]): DemoState {
    const s = full();
    return { ...s, entries };
  }

  it('splits operasional/tabungan, kantor and transfer totals', () => {
    const s = stateWith([
      mk('1', { kind: 'income', amount: 1000, accountId: 'acc-bca' }),
      mk('2', { kind: 'income', amount: 300, accountId: 'acc-darurat' }),
      mk('3', { kind: 'expense', amount: 400, accountId: 'acc-tunai' }),
      mk('4', { kind: 'expense', amount: 70, accountId: 'acc-kantor' }),
      mk('5', { kind: 'income', amount: 30, accountId: 'acc-kantor' }),
      mk('6', {
        kind: 'transfer',
        amount: 200,
        accountId: 'acc-bca',
        counterAccountId: 'acc-tunai',
      }),
      mk('7', { kind: 'space_transfer', direction: 'out', amount: 500, accountId: 'acc-bca' }),
      mk('8', {
        kind: 'space_transfer',
        direction: 'in',
        amount: 500,
        accountId: 'acc-rumah',
        ruang: 'bersama',
      }),
      mk('9', { kind: 'opening_balance', amount: 9999, accountId: 'acc-bca' }),
      mk('10', { kind: 'expense', amount: 111, accountId: 'acc-bca', occurredOn: '2026-09-30' }),
      mk('11', {
        kind: 'expense',
        amount: 222,
        accountId: 'acc-bca',
        voidedAt: '2026-10-11T10:00:00+07:00',
      }),
    ]);
    expect(monthSummary(s, 'pribadi', '2026-10')).toEqual({
      pemasukan: 1300,
      pengeluaran: 400,
      selisih: 900,
      kantor: 100,
      transfer: 700,
    });
    expect(monthSummary(s, 'bersama', '2026-10')).toEqual({
      pemasukan: 0,
      pengeluaran: 0,
      selisih: 0,
      kantor: 0,
      transfer: 500,
    });
  });

  it('selisih is pemasukan minus pengeluaran on the seed', () => {
    const s = full();
    const r = monthSummary(s, 'pribadi', '2026-10');
    expect(r.selisih).toBe(r.pemasukan - r.pengeluaran);
    expect(r.kantor).toBeGreaterThan(0);
    expect(r.transfer).toBeGreaterThan(0);
  });
});

describe('entryTitle', () => {
  const base = {
    id: 'x',
    ruang: 'pribadi',
    accountId: 'acc-bca',
    amount: 1000,
    occurredOn: TODAY,
    createdAt: '2026-10-17T09:00:00+07:00',
    createdBy: 'm1',
  } as const;
  const e = (over: Partial<Entry>): Entry => ({ ...base, kind: 'expense', ...over });

  it('prefers description, then category name, then a fallback', () => {
    const s = full();
    const cat = s.categories[0];
    if (!cat) throw new Error('no category');
    expect(entryTitle(s, e({ description: 'Bakso', categoryId: cat.id }))).toBe('Bakso');
    expect(entryTitle(s, e({ categoryId: cat.id }))).toBe(cat.name);
    expect(entryTitle(s, e({}))).toBe('Tanpa kategori');
  });
  it('labels opening balance and transfer', () => {
    const s = full();
    expect(entryTitle(s, e({ kind: 'opening_balance' }))).toBe('Saldo awal');
    expect(entryTitle(s, e({ kind: 'transfer' }))).toBe('Pindah dompet');
    expect(entryTitle(s, e({ kind: 'transfer', description: 'Isi e-wallet' }))).toBe(
      'Isi e-wallet',
    );
  });
  it('space_transfer: sharedNote, then description, then direction fallback', () => {
    const s = full();
    const st = (over: Partial<Entry>) => e({ kind: 'space_transfer', direction: 'in', ...over });
    expect(entryTitle(s, st({ sharedNote: 'Bulanan', description: 'x' }))).toBe('Bulanan');
    expect(entryTitle(s, st({ description: 'Catatan saya' }))).toBe('Catatan saya');
    expect(entryTitle(s, st({}))).toBe('Setoran dari Pribadi');
    expect(entryTitle(s, st({ direction: 'out' }))).toBe('Setoran ke Bersama');
  });
});

describe('signedAmount', () => {
  const mk = (over: Partial<Entry>): Entry => ({
    id: 'x',
    ruang: 'pribadi',
    accountId: 'acc-bca',
    kind: 'expense',
    amount: 5000,
    occurredOn: TODAY,
    createdAt: '2026-10-17T09:00:00+07:00',
    createdBy: 'm1',
    ...over,
  });

  it('signs by kind', () => {
    expect(signedAmount(mk({ kind: 'income' }))).toEqual({ value: 5000, kind: 'income' });
    expect(signedAmount(mk({ kind: 'expense' }))).toEqual({ value: -5000, kind: 'expense' });
    expect(signedAmount(mk({ kind: 'transfer' }))).toEqual({ value: 5000, kind: 'neutral' });
    expect(signedAmount(mk({ kind: 'opening_balance' }))).toEqual({
      value: 5000,
      kind: 'neutral',
    });
  });
  it('space_transfer: in is positive, out is negative', () => {
    expect(signedAmount(mk({ kind: 'space_transfer', direction: 'in' })).value).toBe(5000);
    expect(signedAmount(mk({ kind: 'space_transfer', direction: 'out' })).value).toBe(-5000);
  });
});
