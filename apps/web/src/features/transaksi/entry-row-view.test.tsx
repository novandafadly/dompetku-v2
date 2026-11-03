import {
  createSeed,
  entryCategoryName,
  entryKindLabel,
  entryTitle,
  groupByDay,
  signedAmount,
} from '@dompetku/demo-data';
import type { DemoState, Entry } from '@dompetku/demo-data';
import type { Route } from 'next';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CategoryIcon } from '@/components/ui/category-icon';
import { ClockIcon } from '@/components/ui/icons/clock';
import { TxRow } from '@/components/ui/rows';
import { groupByDayVM } from '@/features/ledger/group-by-day';
import { entryToVM } from './demo-vm';
import { EntryRow } from './entry-row';
import { EntryRowView } from './entry-row-view';

/**
 * `EntryRowView` (VM) = markup `EntryRow` demo lama untuk setiap entri seed, dan
 * `groupByDayVM` (server, mode nyata) = `groupByDay` demo.
 */

const state: DemoState = createSeed({ today: '2026-10-17', variant: 'full' });
const href = (id: string) => `/pribadi/transaksi/${id}` as Route;

/** Salinan beku `EntryRow` demo sebelum pemisahan view (oracle markup). */
function LegacyEntryRow({ entry }: { entry: Entry }) {
  const name = (id: string) => state.accounts.find((a) => a.id === id)?.name ?? '';
  const wallet =
    entry.kind === 'transfer' && entry.counterAccountId !== undefined
      ? `${name(entry.accountId)} → ${name(entry.counterAccountId)}`
      : name(entry.accountId);
  const { value, kind } = signedAmount(entry);
  return (
    <TxRow
      href={href(entry.id)}
      icon={<CategoryIcon name={entryCategoryName(state, entry)} kind={entry.kind} size={20} />}
      label={entryTitle(state, entry)}
      meta={`${entryKindLabel(state, entry)} · ${wallet}`}
      status={
        entry.kind === 'expense' && entry.reimbursable === true ? (
          <span className="flex items-center gap-1 text-meta font-semibold text-warning">
            <ClockIcon size={14} className="shrink-0" />
            Menunggu reimburse
          </span>
        ) : undefined
      }
      value={value}
      kind={kind}
    />
  );
}

const html = (node: React.ReactNode) => renderToStaticMarkup(<ul>{node}</ul>);

describe('EntryRowView setara EntryRow demo lama', () => {
  it('seed mencakup transfer, antar ruang, reimburse, saldo awal', () => {
    const kinds = new Set(state.entries.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(
      ['expense', 'income', 'opening_balance', 'space_transfer', 'transfer'].sort(),
    );
    expect(state.entries.some((e) => e.reimbursable === true)).toBe(true);
  });

  for (const e of state.entries) {
    it(`entri ${e.id} (${e.kind})`, () => {
      const legacy = html(<LegacyEntryRow entry={e} />);
      const vm = entryToVM(state, e);
      expect(
        html(
          <EntryRowView
            entry={vm}
            href={href(e.id)}
            reimburse={e.kind === 'expense' && e.reimbursable === true}
          />,
        ),
      ).toBe(legacy);
      // Pembungkus demo memetakan ke VM lalu merender view yang sama.
      expect(html(<EntryRow state={state} entry={e} href={href(e.id)} />)).toBe(legacy);
    });
  }

  it('VM nyata tanpa kategori dan tanpa deskripsi: Tanpa kategori', () => {
    const out = html(
      <EntryRowView
        entry={{
          id: 'x',
          version: 1,
          kind: 'expense',
          occurredOn: '2026-10-17',
          createdAt: '2026-10-17T10:00:00+07:00',
          createdBy: { id: 'u', name: 'Novanda', initial: 'N' },
          accountId: 'a',
          accountName: 'Kas',
          amount: 12_000,
        }}
        href={href('x')}
      />,
    );
    expect(out).toContain('Tanpa kategori · Kas');
    expect(out).not.toContain('Menunggu reimburse');
  });
});

describe('groupByDayVM oracle terhadap groupByDay', () => {
  const cases: { today: string; ruang: 'pribadi' | 'bersama'; month: string }[] = [
    { today: '2026-10-17', ruang: 'pribadi', month: '2026-10' },
    { today: '2026-10-17', ruang: 'bersama', month: '2026-10' },
    { today: '2026-10-17', ruang: 'pribadi', month: '2026-09' },
    { today: '2026-10-02', ruang: 'pribadi', month: '2026-10' },
    { today: '2026-11-01', ruang: 'bersama', month: '2026-10' },
  ];
  for (const c of cases) {
    it(`${c.ruang} ${c.month} (hari ini ${c.today})`, () => {
      const s = createSeed({ today: c.today, variant: 'full' });
      // Termasuk entri batal: keduanya hanya mengelompokkan entri hidup.
      const entries = s.entries.filter(
        (e) => e.ruang === c.ruang && e.occurredOn.startsWith(c.month),
      );
      expect(entries.length).toBeGreaterThan(0);
      const expected = groupByDay(entries, c.today).map((g) => ({
        date: g.date,
        label: g.label,
        total: g.net,
        ids: g.items.map((e) => e.id),
      }));
      // Urutan masukan diacak: pengelompokan tidak bergantung pada urutan kueri.
      const vms = [...entries].reverse().map((e) => entryToVM(s, e));
      const actual = groupByDayVM(vms, c.today).map((g) => ({
        date: g.date,
        label: g.label,
        total: g.total,
        ids: g.entries.map((e) => e.id),
      }));
      expect(actual).toEqual(expected);
    });
  }

  it('cocokkan saldo dan antar ruang tidak masuk total hari', () => {
    const base = {
      version: 1,
      occurredOn: '2026-10-17',
      createdBy: { id: 'u', name: 'N', initial: 'N' },
      accountId: 'a',
      accountName: 'Kas',
    } as const;
    const groups = groupByDayVM(
      [
        {
          ...base,
          id: '1',
          kind: 'expense',
          amount: 10_000,
          createdAt: '2026-10-17T08:00:00+07:00',
        },
        {
          ...base,
          id: '2',
          kind: 'adjustment',
          amount: 5_000,
          direction: 'in',
          createdAt: '2026-10-17T09:00:00+07:00',
        },
        {
          ...base,
          id: '3',
          kind: 'income',
          amount: 30_000,
          createdAt: '2026-10-17T07:00:00+07:00',
        },
      ],
      '2026-10-17',
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.total).toBe(20_000);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(['2', '1', '3']);
  });
});
