import { describe, expect, it } from 'vitest';
import {
  addPreview,
  cancelPreview,
  groupDebts,
  initialOf,
  paidCaption,
  paidCaptionDetail,
  payFooterLabel,
  payPreview,
  quickOptions,
  selectedQuick,
  walletChangeNote,
} from './present';
import type { DebtListItemVM } from './types';

function debt(over: Partial<DebtListItemVM> & { debtId: string }): DebtListItemVM {
  return {
    contactId: 'c1',
    contactName: 'Budi',
    direction: 'borrowed',
    mode: 'baru',
    title: null,
    principal: 2_000_000,
    paid: 500_000,
    remaining: 1_500_000,
    paidPct: 25,
    settled: false,
    quick: { p25: 375_000, p50: 750_000, full: 1_500_000 },
    openedOn: '2026-10-12',
    accountId: null,
    voidedAt: null,
    ...over,
  };
}

describe('initialOf', () => {
  it('huruf pertama kapital, kosong = ?', () => {
    expect(initialOf('budi')).toBe('B');
    expect(initialOf('  ibu Sari')).toBe('I');
    expect(initialOf('')).toBe('?');
  });
});

describe('groupDebts', () => {
  const rows = [
    debt({ debtId: 'a', contactName: 'Citra', remaining: 100 }),
    debt({ debtId: 'b', contactName: 'Budi', remaining: 900 }),
    debt({ debtId: 'c', contactName: 'Ana', remaining: 900 }),
    debt({ debtId: 'd', direction: 'lent', contactName: 'Dani', remaining: 50 }),
    debt({ debtId: 'e', contactName: 'Eka', remaining: 0, paid: 10, settled: true }),
    debt({ debtId: 'f', contactName: 'Fani', voidedAt: '2026-11-01T10:00:00+07:00' }),
    debt({ debtId: 'g', contactName: 'Gina', voidedAt: '2026-11-05T10:00:00+07:00' }),
  ];
  const g = groupDebts(rows);
  it('sisa terbesar dulu, lalu nama', () => {
    expect(g.borrowed.map((d) => d.debtId)).toEqual(['c', 'b', 'a']);
  });
  it('piutang terpisah, lunas terpisah, dihapus terbaru dulu', () => {
    expect(g.lent.map((d) => d.debtId)).toEqual(['d']);
    expect(g.settled.map((d) => d.debtId)).toEqual(['e']);
    expect(g.deleted.map((d) => d.debtId)).toEqual(['g', 'f']);
  });
  it('utang terhapus tidak masuk kelompok hidup', () => {
    expect([...g.borrowed, ...g.lent, ...g.settled].some((d) => d.voidedAt !== null)).toBe(false);
  });
});

describe('caption', () => {
  it('daftar dan detail', () => {
    expect(paidCaption(25, 2_000_000)).toBe('25% terbayar · dari Rp 2.000.000');
    expect(paidCaptionDetail(25, 500_000, 2_000_000, false)).toBe(
      '25% terbayar · Rp 500.000 dari Rp 2.000.000',
    );
    expect(paidCaptionDetail(100, 2_000_000, 2_000_000, true)).toBe('Rp 2.000.000 terbayar penuh');
  });
});

describe('quickOptions', () => {
  it('25%, 50%, Lunas dengan nama aksesibel memuat nominal', () => {
    const o = quickOptions({ p25: 375_000, p50: 750_000, full: 1_500_000 });
    expect(o.map((x) => x.label)).toEqual(['25%', '50%', 'Lunas']);
    expect(o[0]?.ariaLabel).toBe('25% dari sisa, Rp 375.000');
  });
  it('null disembunyikan, tidak pernah Rp 0', () => {
    expect(quickOptions({ p25: null, p50: 1, full: 3 }).map((x) => x.label)).toEqual([
      '50%',
      'Lunas',
    ]);
    expect(quickOptions({ p25: null, p50: null, full: 1 }).map((x) => x.label)).toEqual(['Lunas']);
  });
  it('hasil sama dengan sisa tidak jadi chip sendiri', () => {
    expect(quickOptions({ p25: 5, p50: 10, full: 10 }).map((x) => x.label)).toEqual([
      '25%',
      'Lunas',
    ]);
  });
  it('sisa 0 = tanpa chip', () => {
    expect(quickOptions({ p25: null, p50: null, full: 0 })).toEqual([]);
  });
  it('terpilih bila jumlah sama persis', () => {
    const o = quickOptions({ p25: 375_000, p50: 750_000, full: 1_500_000 });
    expect(selectedQuick(o, 750_000)).toBe('p50');
    expect(selectedQuick(o, 1_500_000)).toBe('full');
    expect(selectedQuick(o, 750_001)).toBeNull();
    expect(selectedQuick(o, null)).toBeNull();
  });
});

describe('payFooterLabel', () => {
  it('nominal mengikuti isian, pelunasan saat jumlah = sisa', () => {
    expect(payFooterLabel('borrowed', null, 100)).toBe('Bayar');
    expect(payFooterLabel('borrowed', 0, 100)).toBe('Bayar');
    expect(payFooterLabel('borrowed', 40, 100)).toBe('Bayar Rp 40');
    expect(payFooterLabel('borrowed', 100, 100)).toBe('Lunasi Rp 100');
    expect(payFooterLabel('lent', 40, 100)).toBe('Terima Rp 40');
    expect(payFooterLabel('lent', 100, 100)).toBe('Terima pelunasan Rp 100');
  });
});

describe('pratinjau', () => {
  it('bayar utang: sisa turun, saldo turun', () => {
    expect(payPreview('borrowed', 300, 1000, 5000)).toEqual({
      remainingAfter: 700,
      walletAfter: 4700,
      walletDelta: -300,
    });
  });
  it('terima piutang: sisa turun, saldo naik', () => {
    expect(payPreview('lent', 300, 1000, 5000)).toEqual({
      remainingAfter: 700,
      walletAfter: 5300,
      walletDelta: 300,
    });
  });
  it('batal pembayaran: sisa naik, saldo kembali (utang) atau keluar lagi (piutang)', () => {
    expect(cancelPreview('borrowed', 300, 700, 4700)).toEqual({
      remainingAfter: 1000,
      walletAfter: 5000,
      walletDelta: 300,
    });
    expect(cancelPreview('lent', 300, 700, 5300)).toEqual({
      remainingAfter: 1000,
      walletAfter: 5000,
      walletDelta: -300,
    });
  });
  it('tambah: utang masuk, piutang keluar', () => {
    expect(addPreview('borrowed', 200, 50)).toEqual({ walletAfter: 250, walletDelta: 200 });
    expect(addPreview('lent', 200, 50)).toEqual({ walletAfter: -150, walletDelta: -200 });
  });
  it('catatan saldo', () => {
    expect(walletChangeNote('BCA', -375_000)).toBe('Saldo BCA berkurang Rp 375.000');
    expect(walletChangeNote('BCA', 5)).toBe('Saldo BCA bertambah Rp 5');
  });
});
