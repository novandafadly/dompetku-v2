import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountVM, AssetKind, Pocket } from '@/features/ledger/types';
import type { CatatPreset, CatatSource } from './source';
import { useCatat } from './use-catat';

const acc = (
  id: string,
  pocket: Pocket,
  balance = 1_000_000,
  assetKind?: AssetKind,
): AccountVM => ({
  id,
  name: id,
  pocket,
  walletType: 'bank',
  openedOn: '2026-11-01',
  archived: false,
  balance,
  ...(assetKind === undefined ? {} : { assetKind }),
});
// Urutan sengaja: aset di depan supaya bawaan "dompet pertama" tidak jatuh ke aset.
const ACCOUNTS = [
  acc('emas', 'aset', 500_000, 'emas'),
  acc('ajaib', 'aset', 900_000, 'saham'),
  acc('stockbit', 'trading'),
  acc('kantor', 'kantor'),
  acc('tabungan', 'tabungan'),
  acc('bca', 'operasional'),
];

const source: CatatSource = {
  ruangLabel: { pribadi: 'Pribadi', bersama: 'Bersama' },
  options: () => ({ accounts: ACCOUNTS, categories: [] }),
  chips: () => [],
  spaceTransferTargets: () => [],
  save: () => Promise.resolve({ ok: false, code: 'asset_negative' }),
  undo: () => Promise.resolve(false),
};

const setup = (preset?: CatatPreset) =>
  renderHook(() =>
    useCatat({ source, today: '2026-11-16', ruang: 'pribadi', hourWIB: 12, preset }),
  );
const ids = (l: AccountVM[]) => l.map((a) => a.id);

describe('useCatat · aset (S14-AS5)', () => {
  it('pengeluaran/pemasukan: aset bukan pilihan dan bukan bawaan', () => {
    const { result } = setup();
    expect(result.current.draft.accountId).toBe('bca');
    expect(ids(result.current.sourceAccounts)).toEqual(['kantor', 'tabungan', 'bca']);
    act(() => {
      result.current.setType('income');
    });
    expect(ids(result.current.sourceAccounts)).not.toContain('emas');
  });

  it('transfer biasa: aset non-saham ditawarkan; dompet saham tidak pernah (asal maupun tujuan)', () => {
    const { result } = setup();
    act(() => {
      result.current.setType('transfer');
    });
    expect(ids(result.current.sourceAccounts)).toContain('emas');
    expect(ids(result.current.sourceAccounts)).not.toContain('ajaib');
    expect(ids(result.current.destinations)).toContain('emas');
    expect(ids(result.current.destinations)).not.toContain('ajaib');
  });

  it('memilih aset sebagai sumber transfer lalu ganti ke pengeluaran: kembali ke dompet bawaan', () => {
    const { result } = setup();
    act(() => {
      result.current.setType('transfer');
    });
    act(() => {
      result.current.setAccount('emas');
    });
    act(() => {
      result.current.setType('expense');
    });
    expect(result.current.draft.accountId).toBe('bca');
  });

  it('Isi: tujuan terkunci ke aset, sumber dompet biasa (bukan Kantor, Trading, aset)', () => {
    const { result } = setup({
      kind: 'isi',
      account: { id: 'emas', name: 'emas' },
      capitalLeft: 0,
    });
    expect(result.current.draft.type).toBe('transfer');
    expect(result.current.draft.accountId).toBe('bca');
    expect(result.current.draft.counterAccountId).toBe('emas');
    expect(ids(result.current.sourceAccounts)).toEqual(['tabungan', 'bca']);
    expect(ids(result.current.destinations)).toEqual(['emas']);
  });

  it('Cairkan: sumber terkunci ke aset, tujuan dompet biasa; nominal di atas nilai = tidak bisa disimpan', () => {
    const { result } = setup({
      kind: 'cairkan',
      account: { id: 'emas', name: 'emas' },
      capitalLeft: 0,
    });
    expect(result.current.draft.accountId).toBe('emas');
    expect(ids(result.current.sourceAccounts)).toEqual(['emas']);
    expect(ids(result.current.destinations)).toEqual(['tabungan', 'bca']);
    act(() => {
      result.current.setAmount(400_000);
    });
    expect(result.current.assetShort).toBeUndefined();
    expect(result.current.canSave).toBe(true);
    act(() => {
      result.current.setAmount(500_001);
    });
    expect(result.current.assetShort?.id).toBe('emas');
    expect(result.current.canSave).toBe(false);
  });
});
