import { formatRupiah } from '@dompetku/domain';
import { describe, expect, it } from 'vitest';
import type { EntryVM } from '@/features/ledger/types';
import { voidDialogCopyVM, voidSentenceVM, voidedToastVM } from './void-dialog-view';

const base: EntryVM = {
  id: 'e',
  version: 1,
  kind: 'reimbursement',
  occurredOn: '2026-11-02',
  createdAt: '2026-11-02T08:00:00+07:00',
  createdBy: { id: 'u', name: 'N', initial: 'N' },
  accountId: 'a',
  accountName: 'BCA',
  amount: 100_000,
};

describe('Batalkan reimburse dan antar ruang (S7)', () => {
  it('toast reimburse memakai "ke" (uang masuk ke dompet), bukan "dari"', () => {
    expect(voidedToastVM('Pribadi', base)).toBe(
      `Dibatalkan di Pribadi · ${formatRupiah(100_000)} ke BCA`,
    );
  });

  it('kalimat dialog reimburse menambah "Sisa talangan bertambah lagi."', () => {
    expect(voidSentenceVM(base)).toContain(' Sisa talangan bertambah lagi. ');
    expect(voidSentenceVM(base)).toContain('Saldo BCA berkurang');
  });

  it('antar ruang: salinan S7-D1 kedua sisi, tanpa nama dompet ruang lain', () => {
    const st: EntryVM = { ...base, kind: 'space_transfer', direction: 'out', spaceKind: 'shared' };
    expect(voidSentenceVM(st)).toBe(
      'Kedua sisinya dibatalkan bersamaan, di Pribadi dan Bersama. Saldo kedua dompet kembali. Bisa dipulihkan dari Sampah selama 90 hari.',
    );
    expect(voidedToastVM('Bersama', st)).toBe(
      `Dibatalkan di Pribadi dan Bersama · ${formatRupiah(100_000)}`,
    );
  });
});

describe('Batalkan cicilan utang (S11): kalimat searah dengan uangnya', () => {
  const bayar: EntryVM = {
    ...base,
    kind: 'debt_payment',
    direction: 'out',
    occurredOn: '2026-10-14',
    debt: { id: 'u', direction: 'borrowed', contactName: 'Budi' },
  };
  const terima: EntryVM = {
    ...bayar,
    direction: 'in',
    debt: { id: 'u', direction: 'lent', contactName: 'Sari' },
  };

  it('pembayaran utang (uang keluar): saldo bertambah dan sisa utang bertambah lagi', () => {
    expect(voidSentenceVM(bayar)).toBe(
      `Pembayaran 14 Okt 2026 dibatalkan. Saldo BCA bertambah ${formatRupiah(100_000)} dan sisa utang bertambah lagi. Bisa dipulihkan 90 hari dari Sampah.`,
    );
  });

  it('penerimaan piutang (uang masuk): saldo berkurang dan sisa piutang bertambah lagi', () => {
    expect(voidSentenceVM(terima)).toBe(
      `Penerimaan 14 Okt 2026 dibatalkan. Saldo BCA berkurang ${formatRupiah(100_000)} dan sisa piutang bertambah lagi. Bisa dipulihkan 90 hari dari Sampah.`,
    );
  });

  it('pokok pinjaman: arah saldo ikut uangnya (masuk = berkurang, keluar = bertambah)', () => {
    expect(voidSentenceVM({ ...bayar, kind: 'debt_principal', direction: 'in' })).toContain(
      'Saldo BCA berkurang',
    );
    expect(voidSentenceVM({ ...bayar, kind: 'debt_principal', direction: 'out' })).toContain(
      'Saldo BCA bertambah',
    );
  });

  it('toast: uang keluar = dari dompet, uang masuk = ke dompet', () => {
    expect(voidedToastVM('Pribadi', bayar)).toBe(
      `Dibatalkan di Pribadi · ${formatRupiah(100_000)} dari BCA`,
    );
    expect(voidedToastVM('Pribadi', terima)).toBe(
      `Dibatalkan di Pribadi · ${formatRupiah(100_000)} ke BCA`,
    );
  });
});

describe('judul dialog Batalkan per jenis', () => {
  it('cicilan: pembayaran atau penerimaan; antar ruang: transfer; lainnya: salinan tetap', () => {
    const e: EntryVM = { ...base, kind: 'debt_payment', direction: 'out' };
    expect(voidDialogCopyVM(e)).toEqual({
      title: 'Batalkan pembayaran ini?',
      confirmLabel: 'Batalkan pembayaran',
    });
    expect(voidDialogCopyVM({ ...e, direction: 'in' })).toEqual({
      title: 'Batalkan penerimaan ini?',
      confirmLabel: 'Batalkan penerimaan',
    });
    expect(
      voidDialogCopyVM({ ...base, kind: 'space_transfer', direction: 'out' })?.confirmLabel,
    ).toBe('Batalkan transfer');
    expect(voidDialogCopyVM({ ...base, kind: 'expense' })).toBeNull();
  });
});
