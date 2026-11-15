import type { GoalVM } from '../types';

/** Tujuan aktif berjalan (45%, tanggal target, 4 periode): dasar semua tes S13. */
export function goal(over: Partial<GoalVM> = {}): GoalVM {
  return {
    goalId: 'g1',
    name: 'Dana darurat',
    accountId: 'a1',
    accountName: 'Tabungan BCA',
    accountArchived: false,
    status: 'active',
    target: 10_000_000,
    targetOn: '2027-03-25',
    completedOn: null,
    archivedOn: null,
    createdByName: null,
    balance: 4_500_000,
    saved: 4_500_000,
    remaining: 5_500_000,
    pct: 45,
    reached: false,
    periodsLeft: 4,
    perPeriod: 1_375_000,
    accountHasOtherActive: false,
    ...over,
  };
}
