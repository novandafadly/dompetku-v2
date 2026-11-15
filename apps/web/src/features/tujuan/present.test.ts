import { describe, expect, it } from 'vitest';
import { goal } from './__fixtures__/goal';
import { goalState, isNegative, restoreState, savedBand } from './present';

describe('goalState', () => {
  it('berjalan, tercapai (menang atas lewat tanggal), lewat tanggal', () => {
    expect(goalState(goal())).toBe('running');
    expect(goalState(goal({ reached: true, periodsLeft: null, perPeriod: null }))).toBe('reached');
    expect(goalState(goal({ periodsLeft: null, perPeriod: null }))).toBe('overdue');
    // Tanpa tanggal target tidak pernah "lewat".
    expect(goalState(goal({ targetOn: null, periodsLeft: null, perPeriod: null }))).toBe('running');
  });
});

describe('savedBand', () => {
  it('none: saldo 0 atau minus; tiny: ada uang tetapi persen 0; normal', () => {
    expect(savedBand(goal({ saved: 0, pct: 0, balance: 0 }))).toBe('none');
    expect(savedBand(goal({ saved: 0, pct: 0, balance: -50_000 }))).toBe('none');
    expect(savedBand(goal({ saved: 50_000, pct: 0 }))).toBe('tiny');
    expect(savedBand(goal())).toBe('normal');
  });

  it('isNegative hanya untuk saldo di bawah nol', () => {
    expect(isNegative(goal({ balance: -1 }))).toBe(true);
    expect(isNegative(goal({ balance: 0 }))).toBe(false);
  });
});

describe('restoreState', () => {
  it('dompet terarsip menang, lalu dompet dipakai tujuan lain', () => {
    expect(restoreState(goal({ accountArchived: true, accountHasOtherActive: true }))).toBe(
      'archived-wallet',
    );
    expect(restoreState(goal({ accountHasOtherActive: true }))).toBe('wallet-busy');
    expect(restoreState(goal())).toBe('ok');
  });
});
