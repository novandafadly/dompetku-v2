import { describe, expect, it } from 'vitest';
import { payableAccounts } from './bill-sheet';
import { dueSub, groupBills, rowAction } from './bills';
import type { BillDueVM, BillListVM } from './types';

const bill = (over: Partial<BillListVM> = {}): BillListVM => ({
  billId: 'b1',
  name: 'Listrik PLN',
  amount: 485_000,
  categoryId: 'k',
  categoryName: 'Listrik & Air',
  rootCategoryId: 'k',
  accountId: null,
  accountName: null,
  dayOfMonth: 5,
  startsOn: '2026-01-01',
  endsOn: null,
  archived: false,
  nextDueOn: null,
  nextOccurrenceId: null,
  ...over,
});
const occ = (over: Partial<BillDueVM> = {}): BillDueVM => ({
  occurrenceId: 'o1',
  billId: 'b1',
  name: 'Listrik PLN',
  amount: 485_000,
  dueOn: '2026-11-10',
  daysUntil: 4,
  overdue: false,
  posted: false,
  skipped: false,
  entryId: null,
  paidOn: null,
  ...over,
});

describe('groupBills', () => {
  it('lewat, periode ini, berikutnya, arsip; tagihan tanpa kemunculan masuk Berikutnya', () => {
    const g = groupBills({
      bills: [
        bill(),
        bill({ billId: 'b2', name: 'Internet' }),
        bill({ billId: 'b3', name: 'Mulai Nanti' }),
        bill({ billId: 'b4', name: 'Lama', archived: true }),
      ],
      due: [
        occ({ occurrenceId: 'o0', dueOn: '2026-11-01', daysUntil: -5, overdue: true }),
        occ({ occurrenceId: 'o1' }),
        occ({
          occurrenceId: 'o2',
          billId: 'b2',
          posted: true,
          paidOn: '2026-11-02',
          daysUntil: -4,
        }),
      ],
      upcoming: [occ({ occurrenceId: 'o3', dueOn: '2026-12-10', daysUntil: 34 })],
    });
    expect(g.overdue.map((i) => i.occ?.occurrenceId)).toEqual(['o0']);
    expect(g.period.map((i) => i.occ?.occurrenceId)).toEqual(['o1', 'o2']);
    expect(g.next.map((i) => i.occ?.occurrenceId ?? i.bill.billId)).toEqual(['o3', 'b3']);
    expect(g.archived.map((b) => b.billId)).toEqual(['b4']);
  });

  it('kemunculan tagihan terarsip tidak tampil', () => {
    const g = groupBills({
      bills: [bill({ archived: true })],
      due: [occ()],
      upcoming: [],
    });
    expect(g.period).toEqual([]);
  });
});

describe('dueSub', () => {
  it.each([
    [{ daysUntil: 0 }, 'Hari ini'],
    [{ daysUntil: 1 }, 'Besok'],
    [{ daysUntil: 4 }, '4 hari lagi'],
    [{ daysUntil: 30 }, '30 hari lagi'],
    [{ daysUntil: 31, dueOn: '2026-12-12' }, '12 Des'],
    [{ daysUntil: -1, overdue: true }, 'Lewat 1 hari'],
    [{ daysUntil: -3, overdue: true }, 'Lewat 3 hari'],
    [{ posted: true, paidOn: '2026-10-21' }, 'Lunas · 21 Okt'],
    [{ skipped: true }, 'Dilewati'],
  ] as [Partial<BillDueVM>, string][])('%j -> %s', (over, text) => {
    expect(dueSub(occ(over)).text).toBe(text);
  });
  it('lewat = danger', () => {
    expect(dueSub(occ({ daysUntil: -2, overdue: true })).tone).toBe('danger');
  });
});

describe('rowAction', () => {
  it('Bayar bila terbuka, Batalkan lewati bila dilewati, tanpa aksi bila lunas', () => {
    expect(rowAction(occ())).toBe('bayar');
    expect(rowAction(occ({ skipped: true }))).toBe('batalkan');
    expect(rowAction(occ({ posted: true }))).toBeNull();
    expect(rowAction(null)).toBeNull();
  });
});

describe('payableAccounts', () => {
  const acc = (over: Record<string, unknown>) => ({
    id: 'a',
    name: 'A',
    pocket: 'operasional' as const,
    walletType: 'bank' as const,
    openedOn: '2026-01-01',
    archived: false,
    balance: 0,
    ...over,
  });
  it('tanpa Kas Kantor dan dompet terarsip', () => {
    const r = payableAccounts([
      acc({ id: '1' }),
      acc({ id: '2', pocket: 'kantor' }),
      acc({ id: '3', archived: true }),
      acc({ id: '4', pocket: 'tabungan' }),
    ]);
    expect(r.map((a) => a.id)).toEqual(['1', '4']);
  });
});
