import { describe, expect, it } from 'vitest';
import { matchWallet, walletHandle, type WalletOption } from './wallet';

const w = (id: string, name: string, pocket: WalletOption['pocket'] = 'operasional') => ({
  id,
  name,
  pocket,
});
const BCA = w('1', 'BCA');
const CIMB = w('2', 'CIMB Niaga');
const TUNAI = w('3', 'Tunai');
const SYARIAH = w('4', 'BCA Syariah');
const KANTOR = w('5', 'Kas Kantor', 'kantor');
const TAB = w('6', 'Deposito', 'tabungan');
const ALL = [BCA, CIMB, TUNAI, SYARIAH, KANTOR, TAB];

describe('matchWallet', () => {
  it('awalan nama, tanpa beda huruf besar/kecil', () => {
    expect(matchWallet('cimb', ALL)).toEqual({ kind: 'found', wallet: CIMB });
    expect(matchWallet('CIM', ALL)).toEqual({ kind: 'found', wallet: CIMB });
    expect(matchWallet('tun', ALL)).toEqual({ kind: 'found', wallet: TUNAI });
  });
  it('nama persis menang atas awalan (bca vs BCA Syariah)', () => {
    expect(matchWallet('bca', ALL)).toEqual({ kind: 'found', wallet: BCA });
    expect(matchWallet('bcasyariah', ALL)).toEqual({ kind: 'found', wallet: SYARIAH });
    expect(matchWallet('bca-syariah', ALL)).toEqual({ kind: 'found', wallet: SYARIAH });
  });
  it('awalan ganda = ambiguous dengan daftar kandidat', () => {
    const noExact = [CIMB, w('7', 'CIMB Syariah'), TUNAI];
    expect(matchWallet('cim', noExact)).toEqual({
      kind: 'ambiguous',
      candidates: [CIMB, noExact[1]],
    });
  });
  it('spasi dan tanda baca pada nama tidak dihitung', () => {
    expect(matchWallet('kas-kantor', ALL)).toEqual({ kind: 'found', wallet: KANTOR });
    expect(matchWallet('kaskantor', ALL)).toEqual({ kind: 'found', wallet: KANTOR });
    const paren = w('8', 'BCA (utama)');
    expect(matchWallet('bca-utama', [paren])).toEqual({ kind: 'found', wallet: paren });
  });
  it('awalan kata dalam nama dan nama kantong (tingkat terakhir)', () => {
    expect(matchWallet('kantor', ALL)).toEqual({ kind: 'found', wallet: KANTOR });
    expect(matchWallet('niaga', ALL)).toEqual({ kind: 'found', wallet: CIMB });
    expect(matchWallet('tabungan', ALL)).toEqual({ kind: 'found', wallet: TAB });
    // dua kata cocok di tingkat yang sama
    expect(matchWallet('syariah', [SYARIAH, w('9', 'CIMB Syariah')])).toMatchObject({
      kind: 'ambiguous',
    });
  });
  it('nama menang atas kata/kantong di tingkat lebih tinggi', () => {
    const kantorName = w('10', 'Kantor Baru', 'operasional');
    expect(matchWallet('kantor', [KANTOR, kantorName])).toEqual({
      kind: 'found',
      wallet: kantorName,
    });
  });
  it('tidak ada kecocokan, atau penanda kosong sesudah normalisasi', () => {
    expect(matchWallet('mandiri', ALL)).toEqual({ kind: 'none' });
    expect(matchWallet('--', ALL)).toEqual({ kind: 'none' });
    expect(matchWallet('_', ALL)).toEqual({ kind: 'none' });
    expect(matchWallet('cimb', [])).toEqual({ kind: 'none' });
  });
  it('hanya dompet yang diberikan: tanpa kantor, @kantor tidak ketemu (ruang Bersama)', () => {
    expect(matchWallet('kantor', [BCA, TUNAI])).toEqual({ kind: 'none' });
  });
  it('diakritik dan lebar penuh disamakan', () => {
    const d = w('11', 'Dompét Ibu');
    expect(matchWallet('dompet', [d])).toEqual({ kind: 'found', wallet: d });
    expect(matchWallet('ｃｉｍｂ', ALL)).toEqual({ kind: 'found', wallet: CIMB });
  });
});

describe('walletHandle', () => {
  it('nama jadi penanda siap ketik', () => {
    expect(walletHandle('Kas Kantor')).toBe('@kas-kantor');
    expect(walletHandle('BCA (utama)')).toBe('@bca-utama');
    expect(walletHandle('CIMB')).toBe('@cimb');
  });
  it('tanpa huruf/angka = null', () => {
    expect(walletHandle('★★')).toBeNull();
  });
  it('penanda yang dihasilkan selalu mencocokkan dompetnya sendiri', () => {
    for (const a of ALL) {
      const h = walletHandle(a.name)?.slice(1) ?? '';
      expect(matchWallet(h, ALL)).toEqual({ kind: 'found', wallet: a });
    }
  });
});
