import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountVM, Pocket } from '@/features/ledger/types';
import type { CatatPreset, CatatSource } from './source';
import { useCatat } from './use-catat';

const acc = (id: string, pocket: Pocket, balance = 1_000_000): AccountVM => ({
  id,
  name: id,
  pocket,
  walletType: 'bank',
  openedOn: '2026-11-01',
  archived: false,
  balance,
});
// Urutan sengaja: Trading di depan supaya bawaan "dompet pertama" tidak jatuh ke Trading.
const ACCOUNTS = [
  acc('stockbit', 'trading'),
  acc('kantor', 'kantor'),
  acc('tabungan', 'tabungan'),
  acc('bca', 'operasional'),
  acc('ajaib', 'trading'),
];

const source: CatatSource = {
  ruangLabel: { pribadi: 'Pribadi', bersama: 'Bersama' },
  options: () => ({ accounts: ACCOUNTS, categories: [] }),
  chips: () => [],
  spaceTransferTargets: () => [],
  save: () => Promise.resolve({ ok: false, code: 'unknown' }),
  undo: () => Promise.resolve(false),
};

const setup = (preset?: CatatPreset) =>
  renderHook(() =>
    useCatat({ source, today: '2026-11-14', ruang: 'pribadi', hourWIB: 12, preset }),
  );
const ids = (l: AccountVM[]) => l.map((a) => a.id);

describe('useCatat · Trading (S12-TR4)', () => {
  it('pengeluaran/pemasukan: Trading bukan pilihan dan bukan bawaan; transfer: boleh', () => {
    const { result } = setup();
    expect(result.current.draft.accountId).toBe('bca');
    expect(ids(result.current.sourceAccounts)).toEqual(['kantor', 'tabungan', 'bca']);
    act(() => {
      result.current.setType('income');
    });
    expect(ids(result.current.sourceAccounts)).not.toContain('stockbit');
    act(() => {
      result.current.setType('transfer');
    });
    expect(ids(result.current.sourceAccounts)).toContain('stockbit');
    expect(ids(result.current.destinations)).toContain('ajaib');
  });

  it('memilih Trading sebagai sumber transfer lalu ganti ke pengeluaran: kembali ke dompet bawaan', () => {
    const { result } = setup();
    act(() => {
      result.current.setType('transfer');
    });
    act(() => {
      result.current.setAccount('stockbit');
    });
    act(() => {
      result.current.setType('expense');
    });
    expect(result.current.draft.accountId).toBe('bca');
  });

  it('Setor modal: tujuan terkunci ke dompet trading, sumber dompet biasa (bukan Kantor/Trading)', () => {
    const { result } = setup({
      kind: 'setor',
      account: { id: 'stockbit', name: 'stockbit' },
      capitalLeft: 0,
    });
    expect(result.current.draft.type).toBe('transfer');
    expect(result.current.draft.accountId).toBe('bca');
    expect(result.current.draft.counterAccountId).toBe('stockbit');
    expect(ids(result.current.sourceAccounts)).toEqual(['tabungan', 'bca']);
    expect(ids(result.current.destinations)).toEqual(['stockbit']);
    act(() => {
      result.current.setAmount(500_000);
    });
    expect(result.current.canSave).toBe(true);
  });

  it('Tarik modal: sumber terkunci ke dompet trading, tujuan dompet biasa terpilih bawaan', () => {
    const { result } = setup({
      kind: 'tarik',
      account: { id: 'stockbit', name: 'stockbit' },
      capitalLeft: 1_000_000,
    });
    expect(result.current.draft.accountId).toBe('stockbit');
    expect(result.current.draft.counterAccountId).toBe('bca');
    expect(ids(result.current.sourceAccounts)).toEqual(['stockbit']);
    expect(ids(result.current.destinations)).toEqual(['tabungan', 'bca']);
  });
});
