import { createElement, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { createDemoStore, createSeed } from '@dompetku/demo-data';
import type { DemoState, DemoStore, Ruang } from '@dompetku/demo-data';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AccountVM, CategoryVM } from '@/features/ledger/types';
import { demoCatatSource } from './demo-source';
import type { CatatOptions, CatatSource, SaveOutcome } from './source';
import { useCatat } from './use-catat';

const TODAY = '2026-10-17';
const full = (): DemoState => createSeed({ today: TODAY, variant: 'full' });

function setup(store: DemoStore, ruang: Ruang) {
  const source = demoCatatSource(store.getState(), store);
  return renderHook(() => useCatat({ source, today: TODAY, ruang, hourWIB: 12 }));
}

describe('useCatat (sumber demo)', () => {
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

  it('switchRuang resets wallet, category and clientId; keeps the amount', () => {
    const store = createDemoStore(full());
    const { result } = setup(store, 'bersama');
    expect(result.current.accounts.map((a) => a.name)).toEqual(['Kas Rumah', 'Tabungan Liburan']);
    act(() => {
      result.current.setAmount(35_000);
    });
    const id0 = result.current.draft.clientId;
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
    // Ruang baru = niat baru: kunci idempoten baru.
    expect(d.clientId).not.toBe(id0);
    const pribadiIds = new Set(
      store
        .getState()
        .categories.filter((c) => c.ruang === 'pribadi')
        .map((c) => c.id),
    );
    expect(result.current.chips.every((c) => pribadiIds.has(c.id))).toBe(true);
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

  it('keeps clientId across a failed save; retry stores one entry; then regenerates', async () => {
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
    let saved: SaveOutcome | null = null;
    await act(async () => {
      saved = await result.current.save();
    });
    expect(saved).toEqual({ ok: false, code: 'network' });
    expect(result.current.status).toBe('galat');
    expect(result.current.draft.clientId).toBe(id0);
    expect(result.current.draft.amount).toBe(35_000);

    await act(async () => {
      saved = await result.current.retry();
    });
    expect(saved).toMatchObject({ ok: true });
    expect(result.current.status).toBe('idle');
    expect(real.getState().entries.filter((e) => e.clientId === id0)).toHaveLength(1);
    expect(result.current.draft.clientId).not.toBe(id0);
  });

  it('toast demo: "Tersimpan di {Ruang} · {Rp} dari {dompet}"; pemasukan "ke {dompet}"', async () => {
    const store = createDemoStore(full());
    const { result } = setup(store, 'pribadi');
    act(() => {
      result.current.setAmount(35_000);
      result.current.setCategory(result.current.chips[0]?.id ?? '');
    });
    let out: SaveOutcome | null = null;
    await act(async () => {
      out = await result.current.save();
    });
    expect(out).toMatchObject({ ok: true, toast: 'Tersimpan di Pribadi · Rp 35.000 dari BCA' });

    act(() => {
      result.current.setType('income');
    });
    act(() => {
      result.current.setCategory(result.current.chips[0]?.id ?? '');
    });
    await act(async () => {
      out = await result.current.save();
    });
    expect(out).toMatchObject({ ok: true, toast: 'Tersimpan di Pribadi · Rp 35.000 ke BCA' });
  });
});

// ===== Sumber palsu: keadaan simpan =====

const acc = (id: string, name: string, balance: number, extra: Partial<AccountVM> = {}) =>
  ({
    id,
    name,
    pocket: 'operasional',
    walletType: 'bank',
    openedOn: '2026-01-01',
    archived: false,
    balance,
    ...extra,
  }) satisfies AccountVM;

const cat = (id: string, name: string, type: 'income' | 'expense' = 'expense'): CategoryVM => ({
  id,
  parentId: null,
  name,
  type,
  icon: 'Tag',
  archived: false,
});

const OPTIONS: Record<Ruang, CatatOptions> = {
  pribadi: {
    accounts: [acc('p-bca', 'BCA', 100_000), acc('p-tunai', 'Tunai', 20_000)],
    categories: [cat('p-makan', 'Makan'), cat('p-kopi', 'Kopi'), cat('p-gaji', 'Gaji', 'income')],
  },
  bersama: {
    accounts: [acc('b-rumah', 'Kas Rumah', 500_000)],
    categories: [cat('b-dapur', 'Dapur')],
  },
};

function fakeSource(save: CatatSource['save'], over: Partial<Omit<CatatSource, 'save'>> = {}) {
  const source = {
    ruangLabel: { pribadi: 'Pribadi', bersama: 'Bersama' },
    options: vi.fn((r: Ruang) => OPTIONS[r]),
    chips: vi.fn((r: Ruang, type: 'income' | 'expense') =>
      OPTIONS[r].categories.filter((c) => c.type === type),
    ),
    spaceTransferTargets: vi.fn(() => []),
    save: vi.fn(save),
    undo: vi.fn(() => Promise.resolve(true)),
    ...over,
  };
  return source;
}

const OK: SaveOutcome = { ok: true, entryId: 'e1', version: 1, replayed: false, toast: 'ok' };

function render(source: CatatSource, ruang: Ruang = 'pribadi') {
  const r = renderHook(() => useCatat({ source, today: TODAY, ruang, hourWIB: 12 }));
  act(() => {
    r.result.current.setAmount(35_000);
    r.result.current.setCategory('p-makan');
  });
  return r;
}

describe('useCatat keadaan simpan', () => {
  it("menyimpan: save menunggu → status 'menyimpan', canSave false; klik ganda tidak mengirim dua kali", async () => {
    let resolve!: (o: SaveOutcome) => void;
    const source = fakeSource(
      () =>
        new Promise<SaveOutcome>((r) => {
          resolve = r;
        }),
    );
    const { result } = render(source);
    let first!: Promise<SaveOutcome | null>;
    let second: SaveOutcome | null = OK;
    act(() => {
      first = result.current.save();
    });
    expect(result.current.status).toBe('menyimpan');
    expect(result.current.canSave).toBe(false);
    await act(async () => {
      second = await result.current.save();
    });
    expect(second).toBeNull();
    expect(source.save).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(OK);
      await first;
    });
    expect(result.current.status).toBe('idle');
  });

  it('klik ganda dalam satu tick (sebelum render ulang) tetap satu permintaan', async () => {
    const source = fakeSource(() => Promise.resolve(OK));
    const { result } = render(source);
    await act(async () => {
      const save = result.current.save;
      await Promise.all([save(), save()]);
    });
    expect(source.save).toHaveBeenCalledTimes(1);
  });

  it('galat lalu coba lagi memakai clientId sama', async () => {
    const source = fakeSource(() => Promise.resolve({ ok: false, code: 'network' }));
    const { result } = render(source);
    const id0 = result.current.draft.clientId;
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toBe('galat');
    expect(result.current.draft).toMatchObject({ amount: 35_000, categoryId: 'p-makan' });
    source.save.mockImplementation(() =>
      Promise.resolve({ ...OK, replayed: true } satisfies SaveOutcome),
    );
    await act(async () => {
      await result.current.retry();
    });
    expect(source.save).toHaveBeenCalledTimes(2);
    expect(source.save.mock.calls[0]?.[0].clientId).toBe(id0);
    expect(source.save.mock.calls[1]?.[0].clientId).toBe(id0);
    expect(result.current.status).toBe('idle');
  });

  it('saldo_negatif → status saldo_kurang; saveAnyway() mengirim allowNegative true', async () => {
    const source = fakeSource(() => Promise.resolve({ ok: false, code: 'saldo_negatif' }));
    const { result } = render(source);
    const id0 = result.current.draft.clientId;
    act(() => {
      result.current.setAmount(150_000);
    });
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toBe('saldo_kurang');
    expect(source.save.mock.calls[0]?.[0].allowNegative).toBe(false);
    source.save.mockImplementation(() => Promise.resolve(OK));
    await act(async () => {
      await result.current.saveAnyway();
    });
    expect(source.save.mock.calls[1]?.[0]).toMatchObject({ allowNegative: true, clientId: id0 });
    expect(result.current.status).toBe('idle');
  });

  it('saldo_kurang hilang bila nominal diubah sampai cukup', async () => {
    const source = fakeSource(() => Promise.resolve({ ok: false, code: 'saldo_negatif' }));
    const { result } = render(source);
    act(() => {
      result.current.setAmount(150_000);
    });
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toBe('saldo_kurang');
    act(() => {
      result.current.setAmount(120_000);
    });
    expect(result.current.status).toBe('saldo_kurang');
    act(() => {
      result.current.setAmount(90_000);
    });
    expect(result.current.status).toBe('idle');
  });

  it('idem_mismatch → saveAsNew() mengirim clientId baru', async () => {
    const source = fakeSource(() => Promise.resolve({ ok: false, code: 'idem_mismatch' }));
    const { result } = render(source);
    const id0 = result.current.draft.clientId;
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toBe('idem_mismatch');
    source.save.mockImplementation(() => Promise.resolve(OK));
    await act(async () => {
      await result.current.saveAsNew();
    });
    const sent = source.save.mock.calls[1]?.[0].clientId;
    expect(sent).toBeDefined();
    expect(sent).not.toBe(id0);
    expect(result.current.status).toBe('idle');
  });

  it("before_opening → status field, field 'occurred_on'; hilang saat tanggal diganti", async () => {
    const source = fakeSource(() => Promise.resolve({ ok: false, code: 'before_opening' }));
    const { result } = render(source);
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toBe('field');
    expect(result.current.field).toBe('occurred_on');
    expect(result.current.fieldCode).toBe('before_opening');
    act(() => {
      result.current.setDate('2026-10-16');
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.field).toBeNull();
  });

  it("account_archived → status field, field 'account_id'; dompet itu hilang dari daftar", async () => {
    const source = fakeSource(() => Promise.resolve({ ok: false, code: 'account_archived' }));
    const { result } = render(source);
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toBe('field');
    expect(result.current.field).toBe('account_id');
    expect(result.current.archivedAccount?.name).toBe('BCA');
    expect(result.current.accounts.map((a) => a.id)).toEqual(['p-tunai']);
    act(() => {
      result.current.setAccount('p-tunai');
    });
    expect(result.current.status).toBe('idle');
  });

  it('switchRuang meminta options ruang tujuan dan clientId baru', () => {
    const source = fakeSource(() => Promise.resolve(OK));
    const { result } = render(source);
    const id0 = result.current.draft.clientId;
    act(() => {
      result.current.switchRuang('bersama');
    });
    expect(source.options).toHaveBeenLastCalledWith('bersama');
    expect(source.chips).toHaveBeenLastCalledWith('bersama', 'expense', 12);
    expect(result.current.draft).toMatchObject({ ruang: 'bersama', accountId: 'b-rumah' });
    expect(result.current.draft.clientId).not.toBe(id0);
    expect(result.current.draft.categoryId).toBeUndefined();
    expect(result.current.draft.amount).toBe(35_000);
  });

  it('switchRuang dengan options async: memuat lalu memakai dompet ruang tujuan', async () => {
    let resolve!: (o: CatatOptions) => void;
    const source = fakeSource(() => Promise.resolve(OK), {
      options: vi.fn((r: Ruang) =>
        r === 'pribadi'
          ? OPTIONS.pribadi
          : new Promise<CatatOptions>((res) => {
              resolve = res;
            }),
      ),
      chips: vi.fn((r: Ruang) => Promise.resolve(OPTIONS[r].categories.slice(0, 1))),
    });
    const { result } = render(source);
    act(() => {
      result.current.switchRuang('bersama');
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.canSave).toBe(false);
    await act(async () => {
      resolve(OPTIONS.bersama);
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.draft).toMatchObject({ ruang: 'bersama', accountId: 'b-rumah' });
    expect(result.current.chips.map((c) => c.id)).toEqual(['b-dapur']);
  });

  it('tanggal belum dipilih = dateChosen false; setDate menandainya', () => {
    const source = fakeSource(() => Promise.resolve(OK));
    const { result } = render(source);
    expect(result.current.draft.dateChosen).toBe(false);
    act(() => {
      result.current.setDate('2026-10-16');
    });
    expect(result.current.draft.dateChosen).toBe(true);
  });

  it('isian dikunci selama menyimpan', () => {
    const source = fakeSource(() => new Promise<SaveOutcome>(() => undefined));
    const { result } = render(source);
    act(() => {
      void result.current.save();
    });
    act(() => {
      result.current.setAmount(1);
    });
    expect(result.current.draft.amount).toBe(35_000);
  });
});

describe('useCatat perbaikan review', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('switchRuang async lalu setType sebelum options tiba → chips mengikuti jenis terbaru', async () => {
    const pending = deferred<CatatOptions>();
    const bersama: CatatOptions = {
      accounts: OPTIONS.bersama.accounts,
      categories: [cat('b-dapur', 'Dapur'), cat('b-bonus', 'Bonus', 'income')],
    };
    const chips = vi.fn((r: Ruang, type: 'income' | 'expense') =>
      (r === 'bersama' ? bersama : OPTIONS[r]).categories.filter((c) => c.type === type),
    );
    const source = fakeSource(() => Promise.resolve(OK), {
      options: vi.fn((r: Ruang) => (r === 'pribadi' ? OPTIONS.pribadi : pending.promise)),
      chips,
    });
    const { result } = render(source);
    act(() => {
      result.current.switchRuang('bersama');
    });
    act(() => {
      result.current.setType('income');
    });
    await act(async () => {
      pending.resolve(bersama);
      await pending.promise;
    });
    expect(chips).toHaveBeenLastCalledWith('bersama', 'income', 12);
    expect(result.current.chips.map((c) => c.id)).toEqual(['b-bonus']);
    expect(result.current.draft.type).toBe('income');
  });

  it('jawaban basi diabaikan: A→B menunggu, B→A, lalu B tiba terlambat', async () => {
    const pending = deferred<CatatOptions>();
    const source = fakeSource(() => Promise.resolve(OK), {
      options: vi.fn((r: Ruang) => (r === 'pribadi' ? OPTIONS.pribadi : pending.promise)),
    });
    const { result } = render(source);
    act(() => {
      result.current.switchRuang('bersama');
    });
    act(() => {
      result.current.switchRuang('pribadi');
    });
    await act(async () => {
      pending.resolve(OPTIONS.bersama);
      await pending.promise;
    });
    expect(result.current.draft).toMatchObject({ ruang: 'pribadi', accountId: 'p-bca' });
    expect(result.current.accounts.map((a) => a.id)).toEqual(['p-bca', 'p-tunai']);
    expect(result.current.chips.every((c) => c.id.startsWith('p-'))).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('pindah ruang gagal: hanya ruang, dompet, clientId yang dipulihkan; suntingan lain tetap', async () => {
    const pending = deferred<CatatOptions>();
    const source = fakeSource(() => Promise.resolve(OK), {
      options: vi.fn((r: Ruang) => (r === 'pribadi' ? OPTIONS.pribadi : pending.promise)),
    });
    const { result } = render(source);
    act(() => {
      result.current.setAccount('p-tunai');
    });
    const before = result.current.draft;
    act(() => {
      result.current.switchRuang('bersama');
    });
    act(() => {
      result.current.setAmount(77_000);
      result.current.setDescription('sore');
    });
    await act(async () => {
      pending.reject(new Error('network'));
      await pending.promise.catch(() => undefined);
    });
    const d = result.current.draft;
    expect(d).toMatchObject({
      ruang: 'pribadi',
      accountId: 'p-tunai',
      clientId: before.clientId,
      amount: 77_000,
      description: 'sore',
    });
    expect(result.current.switchFailed).toBe('bersama');
    expect(result.current.loading).toBe(false);
    expect(result.current.accounts.map((a) => a.id)).toEqual(['p-bca', 'p-tunai']);
  });

  it('setType menghapus saldo_kurang', async () => {
    const source = fakeSource(() => Promise.resolve({ ok: false, code: 'saldo_negatif' }));
    const { result } = render(source);
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toBe('saldo_kurang');
    act(() => {
      result.current.setType('income');
    });
    expect(result.current.status).toBe('idle');
  });

  it("category_archived → field 'category_id', kategori dilepas dan hilang dari chip", async () => {
    const source = fakeSource(() => Promise.resolve({ ok: false, code: 'category_archived' }));
    const { result } = render(source);
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toBe('field');
    expect(result.current.field).toBe('category_id');
    expect(result.current.archivedCategory?.name).toBe('Makan');
    expect(result.current.draft.categoryId).toBeUndefined();
    expect(result.current.chips.map((c) => c.id)).not.toContain('p-makan');
    expect(result.current.allCategories.map((c) => c.id)).not.toContain('p-makan');
    act(() => {
      result.current.setCategory('p-kopi');
    });
    expect(result.current.status).toBe('idle');
  });

  it('not_found → galat tanpa Coba lagi', async () => {
    const source = fakeSource(() => Promise.resolve({ ok: false, code: 'not_found' }));
    const { result } = render(source);
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toBe('galat');
    expect(result.current.galatKind).toBe('not_found');
    expect(result.current.canSave).toBe(false);
    await act(async () => {
      expect(await result.current.retry()).toBeNull();
    });
    expect(source.save).toHaveBeenCalledTimes(1);
  });

  it('not_found bertahan sesudah pindah ruang: Simpan tetap nonaktif sampai sheet ditutup', async () => {
    const source = fakeSource(() => Promise.resolve({ ok: false, code: 'not_found' }));
    const { result } = render(source);
    await act(async () => {
      await result.current.save();
    });
    act(() => {
      result.current.switchRuang('bersama');
    });
    act(() => {
      result.current.setCategory('b-dapur');
    });
    expect(result.current.draft.ruang).toBe('bersama');
    expect(result.current.galatKind).toBe('not_found');
    expect(result.current.status).toBe('galat');
    expect(result.current.canSave).toBe(false);
    await act(async () => {
      expect(await result.current.save()).toBeNull();
      expect(await result.current.saveAsNew()).toBeNull();
    });
    expect(source.save).toHaveBeenCalledTimes(1);
  });

  it('pindah ruang gagal memulihkan dompet/kategori tersembunyi ruang lama', async () => {
    let call = 0;
    const source = fakeSource(
      () =>
        Promise.resolve<SaveOutcome>(
          ++call === 1
            ? { ok: false, code: 'account_archived' }
            : { ok: false, code: 'category_archived' },
        ),
      {
        options: vi.fn((r: Ruang) =>
          r === 'pribadi' ? OPTIONS.pribadi : Promise.reject(new Error('network')),
        ),
      },
    );
    const { result } = render(source);
    await act(async () => {
      await result.current.save();
    });
    act(() => {
      result.current.setAccount('p-tunai');
    });
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.accounts.map((a) => a.id)).toEqual(['p-tunai']);
    expect(result.current.allCategories.map((c) => c.id)).not.toContain('p-makan');
    await act(async () => {
      result.current.switchRuang('bersama');
      await Promise.resolve();
    });
    expect(result.current.switchFailed).toBe('bersama');
    expect(result.current.draft.ruang).toBe('pribadi');
    expect(result.current.accounts.map((a) => a.id)).toEqual(['p-tunai']);
    expect(result.current.allCategories.map((c) => c.id)).not.toContain('p-makan');
  });

  for (const code of ['unknown', 'invalid', 'conflict'] as const) {
    it(`${code} → galat server; Coba lagi memakai clientId sama`, async () => {
      const source = fakeSource(() => Promise.resolve({ ok: false, code }));
      const { result } = render(source);
      const id0 = result.current.draft.clientId;
      await act(async () => {
        await result.current.save();
      });
      expect(result.current.status).toBe('galat');
      expect(result.current.galatKind).toBe('server');
      await act(async () => {
        await result.current.retry();
      });
      expect(source.save.mock.calls[1]?.[0].clientId).toBe(id0);
    });
  }

  it('network → galat jaringan', async () => {
    const source = fakeSource(() => Promise.resolve({ ok: false, code: 'network' }));
    const { result } = render(source);
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.galatKind).toBe('network');
  });
});

describe('useCatat: sumber tidak dipanggil di initializer state (utang S6)', () => {
  const spySource = () => {
    const store = createDemoStore(full());
    const base = demoCatatSource(store.getState(), store);
    const options = vi.fn((r: Ruang) => base.options(r));
    const chips = vi.fn((...a: Parameters<CatatSource['chips']>) => base.chips(...a));
    return { source: { ...base, options, chips } as CatatSource, options, chips };
  };

  it('render server (tanpa efek) memanggil source 0 kali', () => {
    const { source, options, chips } = spySource();
    function Probe() {
      useCatat({ source, today: TODAY, ruang: 'pribadi', hourWIB: 12 });
      return null;
    }
    renderToString(createElement(StrictMode, null, createElement(Probe)));
    expect(options).not.toHaveBeenCalled();
    expect(chips).not.toHaveBeenCalled();
  });

  it('StrictMode: options dan chips dipanggil tepat satu kali, di efek', () => {
    const { source, options, chips } = spySource();
    const { result } = renderHook(
      () => useCatat({ source, today: TODAY, ruang: 'pribadi', hourWIB: 12 }),
      { wrapper: StrictMode },
    );
    expect(options).toHaveBeenCalledTimes(1);
    expect(chips).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.draft.accountId).toBe('acc-bca');
    expect(result.current.chips.length).toBeGreaterThan(0);
  });
});
