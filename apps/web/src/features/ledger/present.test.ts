import { createSeed, entryKindLabel, entryTitle, signedAmount } from '@dompetku/demo-data';
import type { DemoState, Entry } from '@dompetku/demo-data';
import { formatRupiah } from '@dompetku/domain';
import { describe, expect, it } from 'vitest';
import {
  effectOnAccountVM,
  entryKindLabelVM,
  entryTitleVM,
  feeNoteVM,
  signedAmountVM,
} from './present';
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

describe('effectOnAccountVM: efek entri pada satu dompet (riwayat dompet)', () => {
  const base: EntryVM = {
    id: 'e',
    version: 1,
    kind: 'expense',
    occurredOn: '2026-11-01',
    createdAt: '2026-11-01T08:00:00+07:00',
    createdBy: { id: 'u', name: 'N', initial: 'N' },
    accountId: 'a1',
    accountName: 'BCA',
    amount: 25_000,
  };

  it('pengeluaran mengurangi, pemasukan menambah, keduanya berwarna jenisnya', () => {
    expect(effectOnAccountVM(base, 'a1')).toEqual({ value: -25_000, kind: 'expense' });
    expect(effectOnAccountVM({ ...base, kind: 'income' }, 'a1')).toEqual({
      value: 25_000,
      kind: 'income',
    });
  });

  it('transfer: dompet sumber berkurang, dompet lawan bertambah (netral)', () => {
    const t: EntryVM = { ...base, kind: 'transfer', counterAccountId: 'a2' };
    expect(effectOnAccountVM(t, 'a1')).toEqual({ value: -25_000, kind: 'neutral' });
    expect(effectOnAccountVM(t, 'a2')).toEqual({ value: 25_000, kind: 'neutral' });
  });

  it('antar ruang dan cocokkan saldo mengikuti arah; tanpa arah dianggap menambah', () => {
    expect(
      effectOnAccountVM({ ...base, kind: 'space_transfer', direction: 'out' }, 'a1').value,
    ).toBe(-25_000);
    expect(effectOnAccountVM({ ...base, kind: 'adjustment', direction: 'out' }, 'a1').value).toBe(
      -25_000,
    );
    expect(effectOnAccountVM({ ...base, kind: 'adjustment', direction: 'in' }, 'a1').value).toBe(
      25_000,
    );
  });
});

describe('judul kaki antar ruang (S7-D1)', () => {
  const kaki: EntryVM = {
    id: 'e',
    version: 1,
    kind: 'space_transfer',
    occurredOn: '2026-11-02',
    createdAt: '2026-11-02T08:00:00+07:00',
    createdBy: { id: 'u-n', name: 'Novanda', initial: 'N' },
    accountId: 'a',
    accountName: 'Kas',
    amount: 100_000,
  };

  it('kaki Pribadi dari arah, bukan keterangan', () => {
    const p = { ...kaki, spaceKind: 'personal' as const, description: 'bayar kos adik' };
    expect(entryTitleVM({ ...p, direction: 'out' })).toBe('Setor ke Bersama');
    expect(entryTitleVM({ ...p, direction: 'in' })).toBe('Ambil dari Bersama');
  });

  it('kaki Bersama dari nama pencatat, bukan catatan; tidak menyebut Pribadi', () => {
    const b = { ...kaki, spaceKind: 'shared' as const, sharedNote: 'Patungan listrik' };
    expect(entryTitleVM({ ...b, direction: 'in' })).toBe('Setoran dari Novanda');
    expect(entryTitleVM({ ...b, direction: 'out' })).toBe('Diambil oleh Novanda');
  });
});

describe('feeNoteVM: keterangan biaya di daftar (S8-D1a)', () => {
  const kaki: EntryVM = {
    id: 'e',
    version: 1,
    kind: 'space_transfer',
    occurredOn: '2026-11-02',
    createdAt: '2026-11-02T08:00:00+07:00',
    createdBy: { id: 'u-f', name: 'Farida', initial: 'F' },
    accountId: 'a',
    accountName: 'Kas',
    amount: 100_000,
    spaceKind: 'shared',
    direction: 'out',
    fee: 2_500,
  };

  it('kaki keluar Bersama: Biaya Rp {biaya}; nominal bertanda tetap tanpa biaya', () => {
    expect(feeNoteVM(kaki)).toBe(`Biaya ${formatRupiah(2_500)}`);
    expect(signedAmountVM(kaki)).toEqual({ value: -100_000, kind: 'neutral' });
  });

  it('tanpa biaya, kaki masuk, kaki Pribadi, atau jenis lain: tidak ada keterangan', () => {
    const tanpa: EntryVM = { ...kaki };
    delete tanpa.fee;
    expect(feeNoteVM(tanpa)).toBeUndefined();
    expect(feeNoteVM({ ...kaki, direction: 'in' })).toBeUndefined();
    expect(feeNoteVM({ ...kaki, spaceKind: 'personal' })).toBeUndefined();
    expect(feeNoteVM({ ...kaki, kind: 'expense' })).toBeUndefined();
  });
});
