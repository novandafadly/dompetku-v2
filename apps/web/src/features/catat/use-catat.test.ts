import { createDemoStore, createSeed } from '@dompetku/demo-data';
import type { DemoState, DemoStore, Ruang } from '@dompetku/demo-data';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCatat } from './use-catat';

// Di seed tanggal ini dompet operasional Pribadi terakhir dipakai = BCA.
const TODAY = '2026-10-16';
const full = (): DemoState => createSeed({ today: TODAY, variant: 'full' });

function setup(store: DemoStore, ruang: Ruang) {
  return renderHook(() =>
    useCatat({ state: store.getState(), store, today: TODAY, ruang, hourWIB: 12 }),
  );
}

describe('useCatat', () => {
  it('default wallet is the operasional wallet last used in that ruang', () => {
    const store = createDemoStore(full(), { clock: () => '2026-10-17T23:00:00+07:00' });
    expect(setup(store, 'pribadi').result.current.draft.accountId).toBe('acc-bca');
    expect(setup(store, 'bersama').result.current.draft.accountId).toBe('acc-rumah');

    store.addEntry({
      ruang: 'pribadi',
      kind: 'expense',
      occurredOn: TODAY,
      createdBy: 'm-novanda',
      accountId: 'acc-tunai',
      amount: 5_000,
    });
    // Entri terbaru di dompet tabungan tidak menggeser pilihan bawaan.
    store.addEntry({
      ruang: 'pribadi',
      kind: 'income',
      occurredOn: TODAY,
      createdBy: 'm-novanda',
      accountId: 'acc-darurat',
      amount: 5_000,
    });
    const { result } = setup(store, 'pribadi');
    expect(result.current.draft.accountId).toBe('acc-tunai');
    expect(result.current.draft.date).toBe(TODAY);
    expect(result.current.draft.type).toBe('expense');
    expect(result.current.draft.categoryId).toBeUndefined();
  });

  it('switchRuang resets wallet and category to the new ruang, keeps the amount', () => {
    const store = createDemoStore(full());
    const { result } = setup(store, 'bersama');
    expect(result.current.accounts.map((a) => a.name)).toEqual(['Kas Rumah', 'Tabungan Liburan']);
    act(() => {
      result.current.setAmount(35_000);
    });
    const bersamaCat = result.current.chips[0];
    if (!bersamaCat) throw new Error('no chip');
    act(() => {
      result.current.setCategory(bersamaCat.id);
    });
    expect(result.current.canSave).toBe(true);
    act(() => {
      result.current.switchRuang('pribadi');
    });
    const d = result.current.draft;
    expect(d.ruang).toBe('pribadi');
    expect(d.accountId).toBe('acc-bca');
    expect(d.categoryId).toBeUndefined();
    expect(d.amount).toBe(35_000);
    expect(result.current.chips.every((c) => c.ruang === 'pribadi')).toBe(true);
    expect(result.current.canSave).toBe(false);
  });

  it('save is blocked until amount > 0 and a category (or destination wallet) is chosen', () => {
    const store = createDemoStore(full());
    const { result } = setup(store, 'pribadi');
    expect(result.current.canSave).toBe(false);
    act(() => {
      result.current.setAmount(0);
    });
    act(() => {
      result.current.setCategory(result.current.chips[0]?.id ?? '');
    });
    expect(result.current.canSave).toBe(false);
    act(() => {
      result.current.setType('transfer');
      result.current.setAmount(10_000);
    });
    expect(result.current.canSave).toBe(false);
    expect(result.current.destinations.map((a) => a.id)).not.toContain('acc-bca');
    act(() => {
      result.current.setCounterAccount('acc-tunai');
    });
    expect(result.current.canSave).toBe(true);
  });

  it('keeps clientId across a failed save; retry stores one entry; then regenerates', () => {
    const real = createDemoStore(full());
    let failNext = true;
    const flaky: DemoStore = {
      ...real,
      addEntry(e) {
        if (failNext) {
          failNext = false;
          throw new Error('offline');
        }
        return real.addEntry(e);
      },
    };
    const { result } = setup(flaky, 'pribadi');
    const id0 = result.current.draft.clientId;
    act(() => {
      result.current.setAmount(35_000);
      result.current.setCategory(result.current.chips[0]?.id ?? '');
    });
    let saved: ReturnType<typeof result.current.save> = null;
    act(() => {
      saved = result.current.save();
    });
    expect(saved).toBeNull();
    expect(result.current.error).toMatch(/Belum tersimpan/);
    expect(result.current.draft.clientId).toBe(id0);
    expect(result.current.draft.amount).toBe(35_000);

    act(() => {
      saved = result.current.save();
    });
    expect(saved).not.toBeNull();
    expect(result.current.error).toBeNull();
    expect(real.getState().entries.filter((e) => e.clientId === id0)).toHaveLength(1);
    expect(result.current.draft.clientId).not.toBe(id0);
  });
});
