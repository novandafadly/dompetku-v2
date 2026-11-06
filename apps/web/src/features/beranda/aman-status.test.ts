import { describe, expect, it } from 'vitest';
import { amanStatus } from './aman-status';

/** K7: `Lewat` = total < 0; `Hati-hati` = tagihan lewat jatuh tempo atau per hari < rata-rata. */
describe('amanStatus (K7)', () => {
  const pace = (avgDaily: number, overdueBills = 0) => ({ avgDaily, overdueBills });

  it('total negatif = lewat tanpa sebab, walau ada tagihan lewat', () => {
    expect(amanStatus({ aman: -1, perDay: -1 }, pace(50_000, 2))).toEqual({
      status: 'lewat',
      reason: null,
    });
  });

  it('tagihan lewat jatuh tempo = hati-hati (overdue menang atas laju)', () => {
    expect(amanStatus({ aman: 900_000, perDay: 10_000 }, pace(50_000, 2))).toEqual({
      status: 'hati_hati',
      reason: { kind: 'overdue', count: 2 },
    });
  });

  it('per hari di bawah rata-rata = hati-hati karena laju', () => {
    expect(amanStatus({ aman: 300_000, perDay: 49_999 }, pace(50_000))).toEqual({
      status: 'hati_hati',
      reason: { kind: 'pace', avgDaily: 50_000 },
    });
  });

  it('batas tepat sama (per hari = rata-rata) = aman', () => {
    expect(amanStatus({ aman: 500_000, perDay: 50_000 }, pace(50_000))).toEqual({
      status: 'aman',
      reason: null,
    });
  });

  it('total 0: aman bila belum ada belanja, hati-hati bila ada laju', () => {
    expect(amanStatus({ aman: 0, perDay: 0 }, pace(0))).toEqual({ status: 'aman', reason: null });
    expect(amanStatus({ aman: 0, perDay: 0 }, pace(1))).toEqual({
      status: 'hati_hati',
      reason: { kind: 'pace', avgDaily: 1 },
    });
  });

  it('laju 0 tanpa tagihan lewat = aman', () => {
    expect(amanStatus({ aman: 10, perDay: 1 }, pace(0))).toEqual({ status: 'aman', reason: null });
  });
});
