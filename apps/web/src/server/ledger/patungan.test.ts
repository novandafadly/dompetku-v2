import { describe, expect, it } from 'vitest';
import type { SplitCursor } from '@/features/ledger/patungan-types';
import {
  createSplitSchema,
  encodeSplitCursor,
  parseSplitCursor,
  receiveSettlementSchema,
  settleSplitSchema,
} from './patungan';

const ID = '0d6b9a52-7a51-4f43-9d0f-7b1f8b2c0a11';
const U1 = '5f0c3c8e-2f4e-4c1b-8d55-3c5b7e9a1b22';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('kursor riwayat patungan', () => {
  const c: SplitCursor = { on: '2026-11-14', at: '2026-11-14T03:12:45.123456Z', id: ID };

  it('pulang-pergi persis, ≤ 120 karakter', () => {
    const s = encodeSplitCursor(c);
    expect(s.length).toBeLessThanOrEqual(120);
    expect(parseSplitCursor(s)).toEqual(c);
  });

  it.each([
    ['tidak ada', undefined],
    ['kosong', ''],
    ['larik', [b64(`2026-11-14|2026-11-14T03:12:45.123456Z|${ID}`)]],
    ['bukan base64url', 'a+b/c='],
    ['terlalu panjang', 'A'.repeat(121)],
    ['bagian kurang', b64('2026-11-14|2026-11-14T03:12:45.123456Z')],
    ['milidetik', b64(`2026-11-14|2026-11-14T03:12:45.123Z|${ID}`)],
    ['tanggal tidak ada', b64(`2026-02-30|2026-11-14T03:12:45.123456Z|${ID}`)],
    ['instan tidak ada', b64(`2026-11-14|2026-11-14T24:00:00.000000Z|${ID}`)],
    ['bukan uuid', b64('2026-11-14|2026-11-14T03:12:45.123456Z|x')],
    ['injeksi', b64(`2026-11-14'; drop table x; --|2026-11-14T03:12:45.123456Z|${ID}`)],
  ])('%s → null (halaman pertama)', (_, sp) => {
    expect(parseSplitCursor(sp)).toBeNull();
  });
});

describe('skema input patungan', () => {
  it('bagian: maksimal dua anggota, nominal bulat tak negatif', () => {
    const base = { clientId: ID, accountId: ID, amount: 100, categoryId: ID };
    expect(createSplitSchema.safeParse(base).success).toBe(true);
    expect(
      createSplitSchema.safeParse({ ...base, shares: [{ userId: U1, amount: 100 }] }).success,
    ).toBe(true);
    expect(
      createSplitSchema.safeParse({ ...base, shares: [{ userId: U1, amount: -1 }] }).success,
    ).toBe(false);
    expect(
      createSplitSchema.safeParse({ ...base, shares: [{ userId: U1, amount: 1.5 }] }).success,
    ).toBe(false);
    expect(createSplitSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
  });

  it('pelunasan dan terima: nominal positif, tanggal tahun 20xx', () => {
    expect(settleSplitSchema.safeParse({ clientId: ID, accountId: ID, amount: 0 }).success).toBe(
      false,
    );
    expect(
      receiveSettlementSchema.safeParse({
        clientId: ID,
        settlementId: ID,
        accountId: ID,
        occurredOn: '1999-01-01',
      }).success,
    ).toBe(false);
  });
});
