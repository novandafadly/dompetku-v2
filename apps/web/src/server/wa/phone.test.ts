import { describe, expect, it } from 'vitest';
import { toE164 } from './phone';

describe('toE164', () => {
  it.each([
    ['+6281234567890', '+6281234567890'],
    ['6281234567890', '+6281234567890'],
    ['081234567890', '+6281234567890'],
    ['6281234567890@c.us', '+6281234567890'],
    ['6281234567890@s.whatsapp.net', '+6281234567890'],
    ['6281234567890:12@s.whatsapp.net', '+6281234567890'],
    ['  +62 812-3456-7890 ', '+6281234567890'],
    ['14155550123', '+14155550123'],
  ])('%s -> %s', (raw, want) => {
    expect(toE164(raw)).toBe(want);
  });

  it.each([
    ['@lid tanpa senderPhone', '123456789012345@lid'],
    ['grup', '120363025555555555@g.us'],
    ['sufiks lain', '6281234567890@broadcast'],
    ['kosong', ''],
    ['bukan angka', 'halo'],
    ['nol di depan selain 08', '0218765432'],
    ['awalan 00', '006281234567890'],
    ['terlalu pendek', '+6281234'],
    ['terlalu panjang', '+6281234567890123'],
    ['+0', '+0812345678'],
    ['dua tanda +', '++6281234567890'],
    ['huruf di tengah', '62812a4567890'],
    ['@ di depan', '@c.us'],
  ])('%s -> null', (_label, raw) => {
    expect(toE164(raw)).toBeNull();
  });
});
