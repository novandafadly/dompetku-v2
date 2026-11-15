import { describe, expect, it } from 'vitest';
import {
  debtSentence,
  pendingLine,
  sharesRemark,
  savedToast,
  settledToast,
} from '@/features/ledger/patungan-copy';
import { balanceRows, netOf, partnerShareOf } from './present';
import type { SplitBillVM } from '@/features/ledger/patungan-types';

const ME = { id: 'n', name: 'Novanda', initial: 'N' };
const BILL = {
  item: 'split',
  id: 's',
  payerId: 'n',
  amount: 400_000,
  shares: [
    { userId: 'n', amount: 250_000 },
    { userId: 'f', amount: 150_000 },
  ],
} as SplitBillVM;

const nb = (s: string) => s.replace(/\u00a0/g, ' ');

describe('kalimat saldo patungan (dari SQL)', () => {
  const vm = (debtorId: string | null) => ({ me: ME, partner: { name: 'Farida' }, debtorId });

  it('penonton pengutang: Kamu berutang … ke {nama}', () => {
    expect(nb(debtSentence(vm('n'), 200_000).text)).toBe('Kamu berutang Rp 200.000 ke Farida');
  });

  it('penonton pemberi: {nama} berutang … ke kamu', () => {
    expect(nb(debtSentence(vm('f'), 200_000).text)).toBe('Farida berutang Rp 200.000 ke kamu');
  });

  it('nominal besar tetap satu potongan (untuk whitespace-nowrap)', () => {
    expect(nb(debtSentence(vm('f'), 12_345_678_900).amount)).toBe('Rp 12.345.678.900');
  });
});

describe('netOf dan balanceRows', () => {
  it('negatif bila penonton berutang, positif bila lawan berutang, 0 saat impas', () => {
    expect(netOf({ me: ME, debtorId: 'n', amount: 50 })).toBe(-50);
    expect(netOf({ me: ME, debtorId: 'f', amount: 50 })).toBe(50);
    expect(netOf({ me: ME, debtorId: null, amount: null })).toBe(0);
  });

  it('bagian lawan (bukan pembayar) dari SQL', () => {
    expect(partnerShareOf(BILL)).toBe(150_000);
  });

  it('hapus tagihan: pembayar piutang 150.000 → impas; label tanpa Rp 0', () => {
    const rows = balanceRows(150_000, 0, 'Farida');
    expect(rows.nowLabel).toBe('Farida berutang sekarang');
    expect(rows.nowValue).toBe(150_000);
    expect(rows.afterImpas).toBe(true);
    expect(rows.afterLabel).toBe('Sesudahnya');
  });

  it('berbalik arah: kalimat hasil menyebut siapa berutang', () => {
    expect(balanceRows(100, -50, 'Farida').afterLabel).toBe('Sesudahnya: kamu berutang');
    expect(balanceRows(-100, -300, 'Farida').nowLabel).toBe('Kamu berutang sekarang');
  });
});

describe('salinan final', () => {
  it('pending, bagian, toast', () => {
    expect(nb(pendingLine('Farida', 200_000))).toBe(
      'Farida sudah melunasi Rp 200.000. Terima ke dompet?',
    );
    expect(nb(sharesRemark(200_000, true))).toBe(
      'Masing-masing Rp 200.000. Sisa Rp1 ditanggung kamu.',
    );
    expect(nb(sharesRemark(200_000, false))).toBe('Masing-masing Rp 200.000.');
    expect(nb(savedToast(400_000, 'BCA', 'Farida', 200_000))).toBe(
      'Patungan dicatat di Bersama · Rp 400.000 dari BCA · Farida menanggung Rp 200.000',
    );
    expect(nb(settledToast(200_000, 'BCA', 'Novanda'))).toBe(
      'Pelunasan dicatat di Bersama · Rp 200.000 dari BCA · menunggu Novanda menerima',
    );
  });
});
