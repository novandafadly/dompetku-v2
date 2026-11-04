import { describe, expect, it } from 'vitest';
import { openingEditable, openingLockedOn } from './opening';

describe('saldo awal (aturan DB opening_locked)', () => {
  it('bisa diubah sampai hari ke-7 sesudah dompet dibuka, terkunci mulai hari ke-8', () => {
    expect(openingEditable('2026-11-01', '2026-11-01')).toBe(true);
    expect(openingEditable('2026-11-01', '2026-11-08')).toBe(true);
    expect(openingEditable('2026-11-01', '2026-11-09')).toBe(false);
  });

  it('terkunci sejak hari pertama ia tidak bisa diubah lagi', () => {
    expect(openingLockedOn('2026-11-01')).toBe('2026-11-09');
    expect(openingLockedOn('2026-12-28')).toBe('2027-01-05');
  });
});
