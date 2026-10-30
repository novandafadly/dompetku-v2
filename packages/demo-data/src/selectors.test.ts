import { addDays, dayLabel, daysInclusive, endOfMonth } from '@dompetku/domain';
import { describe, expect, it } from 'vitest';
import { createSeed } from './seed';
import { activityFeed, balances, groupByDay, safeToSpend, suggestCategories } from './selectors';
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

  it('prefers categories matching the hour', () => {
    const s = full();
    const noon = suggestCategories(s, 'pribadi', { hourWIB: 12 })[0];
    expect(noon?.name).toBe('Makan Siang & Minum');
  });
});

describe('store', () => {
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
