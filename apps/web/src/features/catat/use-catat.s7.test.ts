import { formatRupiah } from '@dompetku/domain';
import { createDemoStore, createSeed } from '@dompetku/demo-data';
import type { DemoState, DemoStore, Ruang } from '@dompetku/demo-data';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { demoCatatSource } from './demo-source';
import type { CatatSource } from './source';
import { useCatat } from './use-catat';

const TODAY = '2026-10-17';
const full = (): DemoState => createSeed({ today: TODAY, variant: 'full' });

function setup(store: DemoStore, ruang: Ruang, wrap?: (s: CatatSource) => CatatSource) {
  const base = demoCatatSource(store.getState(), store);
  const source = wrap ? wrap(base) : base;
  return { source, ...renderHook(() => useCatat({ source, today: TODAY, ruang, hourWIB: 12 })) };
}

describe('useCatat · transfer antar ruang (S7-C1)', () => {
  it('Pribadi → Bersama: memilih dompet tujuan di ruang lain menyiapkan draf space transfer', () => {
    const store = createDemoStore(full());
    const { result, source } = setup(store, 'pribadi');
    const save = vi.spyOn(source, 'save');
    act(() => {
      result.current.setType('transfer');
      result.current.setAmount(20_000);
    });
    expect(result.current.cross.status).toBe('idle');
    act(() => {
      result.current.loadCrossTargets();
    });
    expect(result.current.cross.target).toBe('bersama');
    expect(result.current.cross.status).toBe('ready');
    const rumah = result.current.cross.accounts.find((a) => a.id === 'acc-rumah');
    expect(rumah).toBeDefined();
    act(() => {
      result.current.setCrossTarget('acc-rumah');
    });
    expect(result.current.draft.toRuang).toBe('bersama');
    expect(result.current.draft.counterAccountId).toBe('acc-rumah');
    expect(result.current.canSave).toBe(true);
    return act(async () => {
      const out = await result.current.save();
      expect(out?.ok).toBe(true);
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'transfer',
          toRuang: 'bersama',
          counterAccountId: 'acc-rumah',
          accountId: 'acc-bca',
        }),
      );
    });
  });

  it('dompet Kantor tidak ditawarkan: bukan tujuan dan bukan sumber', () => {
    const store = createDemoStore(full());
    const { result } = setup(store, 'pribadi');
    act(() => {
      result.current.setType('transfer');
      result.current.loadCrossTargets();
    });
    // Tujuan Bersama: tidak ada Kantor (Kantor hanya di Pribadi).
    expect(result.current.cross.accounts.every((a) => a.pocket !== 'kantor')).toBe(true);
    // Sumber Kantor: antar ruang diblok, dan dompet sumber Kantor tidak jadi pilihan saat antar ruang.
    act(() => {
      result.current.setAccount('acc-kantor');
    });
    expect(result.current.crossBlocked).toBe(true);
    act(() => {
      result.current.setAccount('acc-bca');
      result.current.setCrossTarget('acc-rumah');
    });
    expect(result.current.crossBlocked).toBe(false);
    expect(result.current.sourceAccounts.some((a) => a.pocket === 'kantor')).toBe(false);
    // Ruang lain → Pribadi: dompet Kantor Pribadi tidak muncul sebagai tujuan.
    const store2 = createDemoStore(full());
    const b = setup(store2, 'bersama');
    act(() => {
      b.result.current.setType('transfer');
      b.result.current.loadCrossTargets();
    });
    expect(b.result.current.cross.target).toBe('pribadi');
    expect(b.result.current.cross.accounts.some((a) => a.id === 'acc-kantor')).toBe(false);
    expect(b.result.current.cross.accounts.length).toBeGreaterThan(0);
  });

  it('Catatan untuk Bersama hanya terlihat saat antar ruang; kaki Pribadi menyimpan keterangan, kaki Bersama hanya catatan', async () => {
    const store = createDemoStore(full());
    const { result } = setup(store, 'pribadi');
    act(() => {
      result.current.setType('transfer');
      result.current.setAmount(20_000);
      result.current.loadCrossTargets();
    });
    expect(result.current.sharedNoteVisible).toBe(false);
    act(() => {
      result.current.setCounterAccount('acc-tunai');
    });
    expect(result.current.sharedNoteVisible).toBe(false);
    act(() => {
      result.current.setCrossTarget('acc-rumah');
      result.current.setDescription('bayar kos adik');
      result.current.setSharedNote('Setoran bulanan');
    });
    expect(result.current.sharedNoteVisible).toBe(true);
    let toast = '';
    await act(async () => {
      const out = await result.current.save();
      if (out?.ok) toast = out.toast;
    });
    expect(toast).toBe(`Tersimpan di Pribadi · ${formatRupiah(20_000)} ke Bersama`);
    const legs = store.getState().entries.filter((e) => e.kind === 'space_transfer');
    const out = legs.filter((e) => e.direction === 'out' && e.description === 'bayar kos adik');
    expect(out).toHaveLength(1);
    expect(out[0]?.ruang).toBe('pribadi');
    expect(out[0]?.sharedNote).toBeUndefined();
    const inLeg = legs.find((e) => e.linkId === out[0]?.linkId && e.direction === 'in');
    expect(inLeg?.ruang).toBe('bersama');
    expect(inLeg?.accountId).toBe('acc-rumah');
    expect(inLeg?.sharedNote).toBe('Setoran bulanan');
    expect(inLeg?.description).toBeUndefined();
  });

  it('tanpa catatan bersama: kaki Bersama tidak membawa teks apa pun; dari Bersama keterangan tetap di Pribadi', async () => {
    const store = createDemoStore(full());
    const { result } = setup(store, 'bersama');
    act(() => {
      result.current.setType('transfer');
      result.current.setAmount(10_000);
      result.current.setDescription('ambil untuk listrik');
      result.current.loadCrossTargets();
    });
    const pribadi = result.current.cross.accounts[0];
    if (!pribadi) throw new Error('no target');
    act(() => {
      result.current.setCrossTarget(pribadi.id);
    });
    await act(async () => {
      await result.current.save();
    });
    const legs = store
      .getState()
      .entries.filter(
        (e) => e.clientId === result.current.draft.clientId || e.kind === 'space_transfer',
      );
    const mine = legs.filter((e) => e.description === 'ambil untuk listrik');
    // Keterangan menempel pada kaki Pribadi (tujuan), bukan kaki Bersama.
    expect(mine.every((e) => e.ruang === 'pribadi')).toBe(true);
    expect(mine).toHaveLength(1);
    const bersamaLeg = legs.find((e) => e.linkId === mine[0]?.linkId && e.ruang === 'bersama');
    expect(bersamaLeg?.description).toBeUndefined();
    expect(bersamaLeg?.sharedNote).toBeUndefined();
  });

  it('simpan ulang dengan clientId sama (Coba lagi) tidak menggandakan kedua kaki', async () => {
    const store = createDemoStore(full());
    const { result } = setup(store, 'pribadi');
    act(() => {
      result.current.setType('transfer');
      result.current.setAmount(20_000);
      result.current.loadCrossTargets();
    });
    act(() => {
      result.current.setCrossTarget('acc-rumah');
    });
    const before = store.getState().entries.length;
    const id = result.current.draft.clientId;
    await act(async () => {
      await result.current.save();
    });
    expect(store.getState().entries.length).toBe(before + 2);
    // Simpan ulang dengan clientId lama (mis. balasan hilang): sumber demo mengenali ulangan.
    const again = await demoCatatSource(store.getState(), store).save({
      ...result.current.draft,
      clientId: id,
      allowNegative: false,
    });
    expect(again.ok && again.replayed).toBe(true);
    expect(store.getState().entries.length).toBe(before + 2);
  });

  it('pilihan antar ruang direset saat jenis atau ruang sumber berganti; memilih tujuan satu ruang melepasnya', () => {
    const store = createDemoStore(full());
    const { result } = setup(store, 'pribadi');
    act(() => {
      result.current.setType('transfer');
      result.current.loadCrossTargets();
    });
    act(() => {
      result.current.setCrossTarget('acc-rumah');
      result.current.setSharedNote('x');
    });
    act(() => {
      result.current.setCounterAccount('acc-tunai');
    });
    expect(result.current.draft.toRuang).toBeUndefined();
    expect(result.current.draft.sharedNote).toBeUndefined();
    act(() => {
      result.current.setCrossTarget('acc-rumah');
    });
    act(() => {
      result.current.switchRuang('bersama');
    });
    expect(result.current.draft.toRuang).toBeUndefined();
    expect(result.current.draft.counterAccountId).toBeUndefined();
    expect(result.current.cross.status).toBe('idle');
    act(() => {
      result.current.loadCrossTargets();
    });
    act(() => {
      result.current.setCrossTarget(result.current.cross.accounts[0]?.id ?? '');
    });
    act(() => {
      result.current.setType('expense');
    });
    expect(result.current.draft.toRuang).toBeUndefined();
    expect(result.current.draft.counterAccountId).toBeUndefined();
  });

  it('target yang gagal dimuat: status error, bisa dicoba lagi; jawaban basi diabaikan', async () => {
    const store = createDemoStore(full());
    let fail = true;
    const { result } = setup(store, 'pribadi', (s) => ({
      ...s,
      spaceTransferTargets: (r) =>
        fail ? Promise.reject(new Error('net')) : Promise.resolve(s.spaceTransferTargets(r)),
    }));
    act(() => {
      result.current.setType('transfer');
    });
    await act(async () => {
      result.current.loadCrossTargets();
      await Promise.resolve();
    });
    expect(result.current.cross.status).toBe('error');
    fail = false;
    await act(async () => {
      result.current.loadCrossTargets();
      await Promise.resolve();
    });
    expect(result.current.cross.status).toBe('ready');
  });

  it('galat server cross_space_*: tampil sebagai galat khusus tanpa Coba lagi; memilih ulang menghapusnya', async () => {
    const store = createDemoStore(full());
    const { result } = setup(store, 'pribadi', (s) => ({
      ...s,
      save: () => Promise.resolve({ ok: false, code: 'cross_space_not_allowed' as const }),
    }));
    act(() => {
      result.current.setType('transfer');
      result.current.setAmount(20_000);
      result.current.loadCrossTargets();
    });
    act(() => {
      result.current.setCrossTarget('acc-rumah');
    });
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.galatKind).toBe('cross_space_not_allowed');
    act(() => {
      result.current.setCrossTarget('acc-rumah');
    });
    expect(result.current.galatKind).toBeNull();
  });
});

describe('useCatat · talangan kantor (S7-C2)', () => {
  it('hanya pengeluaran Pribadi dari dompet bukan Kantor', () => {
    const store = createDemoStore(full());
    const { result } = setup(store, 'pribadi');
    expect(result.current.canReimburse).toBe(true);
    act(() => {
      result.current.setAccount('acc-kantor');
    });
    expect(result.current.canReimburse).toBe(false);
    act(() => {
      result.current.setAccount('acc-bca');
      result.current.setType('income');
    });
    expect(result.current.canReimburse).toBe(false);
    const b = setup(store, 'bersama');
    expect(b.result.current.canReimburse).toBe(false);
  });

  it('reset saat pindah jenis, ruang, atau dompet Kantor; mati bawaan', () => {
    const store = createDemoStore(full());
    const { result } = setup(store, 'pribadi');
    expect(result.current.draft.reimbursable).toBeFalsy();
    act(() => {
      result.current.setReimbursable(true);
    });
    expect(result.current.draft.reimbursable).toBe(true);
    act(() => {
      result.current.setType('income');
    });
    expect(result.current.draft.reimbursable).toBeFalsy();
    act(() => {
      result.current.setType('expense');
    });
    expect(result.current.draft.reimbursable).toBeFalsy();
    act(() => {
      result.current.setReimbursable(true);
      result.current.switchRuang('bersama');
    });
    expect(result.current.draft.reimbursable).toBeFalsy();
    act(() => {
      result.current.switchRuang('pribadi');
    });
    act(() => {
      result.current.setReimbursable(true);
    });
    act(() => {
      result.current.setAccount('acc-kantor');
    });
    expect(result.current.draft.reimbursable).toBeFalsy();
    // Tidak bisa dinyalakan di Bersama.
    act(() => {
      result.current.switchRuang('bersama');
    });
    act(() => {
      result.current.setReimbursable(true);
    });
    expect(result.current.draft.reimbursable).toBeFalsy();
  });

  it('simpan membawa reimbursable; toast menyebut Talangan kantor; entri demo menandainya', async () => {
    const store = createDemoStore(full());
    const { result } = setup(store, 'pribadi');
    act(() => {
      result.current.setAmount(50_000);
      result.current.setCategory(result.current.chips[0]?.id ?? '');
      result.current.setReimbursable(true);
    });
    let toast = '';
    await act(async () => {
      const out = await result.current.save();
      if (out?.ok) toast = out.toast;
    });
    expect(toast).toBe(`Tersimpan di Pribadi · ${formatRupiah(50_000)} dari BCA · Talangan kantor`);
    const last = store.getState().entries.at(-1);
    expect(last?.reimbursable).toBe(true);
  });
});
