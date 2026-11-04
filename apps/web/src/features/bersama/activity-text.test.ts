import { formatRupiah } from '@dompetku/domain';
import { describe, expect, it } from 'vitest';
import { activityText, amountChanged } from './activity-text';
import type { SharedActivityRow } from './types';

/** Matriks teks peristiwa S8-A2 (bingkai S8): setiap sel satu kasus uji. */

const CATS: Record<string, string> = { 'c-makan': 'Makan', 'c-belanja': 'Belanja' };
const ctx = { categoryName: (id: string) => CATS[id] ?? null };

const ENTRY = '0d6b9a52-7a51-4f43-9d0f-7b1f8b2c0a11';
const ACTOR = '5f0c3c8e-2f4e-4c1b-8d55-3c5b7e9a1b22';

function row(over: Partial<SharedActivityRow> = {}): SharedActivityRow {
  return {
    entryId: ENTRY,
    version: 1,
    op: 'create',
    kind: 'expense',
    direction: null,
    actorId: ACTOR,
    at: '2026-11-04T10:32:00+07:00',
    occurredOn: '2026-11-04',
    amount: 85_000,
    beforeAmount: null,
    categoryId: 'c-makan',
    beforeCategoryId: null,
    description: null,
    sharedNote: null,
    moved: false,
    ...over,
  };
}

const rp = (n: number) => formatRupiah(n);

describe('activityText: expense dan income [B20]', () => {
  it.each([
    ['expense', 'create', 'mencatat pengeluaran Makan siang'],
    ['expense', 'void', 'membatalkan pengeluaran Makan siang'],
    ['expense', 'restore', 'memulihkan pengeluaran Makan siang'],
    ['income', 'create', 'mencatat pemasukan Makan siang'],
    ['income', 'void', 'membatalkan pemasukan Makan siang'],
    ['income', 'restore', 'memulihkan pemasukan Makan siang'],
  ] as const)('%s %s dengan keterangan: {J} = keterangan', (kind, op, text) => {
    expect(activityText(row({ kind, op, description: 'Makan siang', version: 2 }), ctx)).toEqual({
      text,
      change: [],
    });
  });

  it('{J} tanpa keterangan = nama kategori; tanpa kategori = Tanpa kategori', () => {
    expect(activityText(row(), ctx).text).toBe('mencatat pengeluaran Makan');
    expect(activityText(row({ description: '' }), ctx).text).toBe('mencatat pengeluaran Makan');
    expect(activityText(row({ categoryId: null }), ctx).text).toBe(
      'mencatat pengeluaran Tanpa kategori',
    );
    expect(activityText(row({ categoryId: 'c-hilang', op: 'void' }), ctx).text).toBe(
      'membatalkan pengeluaran Tanpa kategori',
    );
  });

  it('update dengan keterangan: mengubah {description}; tanpa: mengubah pengeluaran/pemasukan', () => {
    const base = {
      op: 'update',
      version: 2,
      beforeAmount: 85_000,
      beforeCategoryId: 'c-makan',
    } as const;
    expect(activityText(row({ ...base, description: 'Makan siang' }), ctx)).toEqual({
      text: 'mengubah Makan siang',
      change: [],
    });
    // Bukan nama kategori sebagai judul (kategori sering justru yang diubah).
    expect(activityText(row({ ...base }), ctx).text).toBe('mengubah pengeluaran');
    expect(activityText(row({ ...base, kind: 'income' }), ctx).text).toBe('mengubah pemasukan');
  });

  it('update nominal berubah: baris Rp lama → Rp baru, sr-only dari … menjadi …', () => {
    const r = row({
      op: 'update',
      version: 2,
      description: 'Makan siang',
      amount: 75_000,
      beforeAmount: 50_000,
      beforeCategoryId: 'c-makan',
    });
    expect(activityText(r, ctx)).toEqual({
      text: 'mengubah Makan siang',
      change: [`${rp(50_000)} → ${rp(75_000)}`],
      srText: `dari ${rp(50_000)} menjadi ${rp(75_000)}`,
    });
    expect(rp(50_000)).toBe('Rp 50.000');
    expect(amountChanged(r)).toBe(true);
  });

  it('update kategori berubah: baris {lama} → {baru}; tanpa keterangan tetap mengubah pengeluaran', () => {
    const r = row({
      op: 'update',
      version: 3,
      categoryId: 'c-belanja',
      beforeCategoryId: 'c-makan',
      beforeAmount: 85_000,
    });
    expect(activityText(r, ctx)).toEqual({
      text: 'mengubah pengeluaran',
      change: ['Makan → Belanja'],
      srText: 'dari Makan menjadi Belanja',
    });
    expect(amountChanged(r)).toBe(false);
  });

  it('update kategori hilang atau tidak dikenal = Tanpa kategori', () => {
    expect(
      activityText(row({ op: 'update', categoryId: null, beforeCategoryId: 'c-makan' }), ctx)
        .change,
    ).toEqual(['Makan → Tanpa kategori']);
    expect(
      activityText(row({ op: 'update', categoryId: 'c-makan', beforeCategoryId: 'c-x' }), ctx)
        .change,
    ).toEqual(['Tanpa kategori → Makan']);
  });

  it('update nominal dan kategori berubah: dua baris, nominal dulu', () => {
    const r = row({
      op: 'update',
      amount: 75_000,
      beforeAmount: 50_000,
      categoryId: 'c-belanja',
      beforeCategoryId: 'c-makan',
    });
    expect(activityText(r, ctx)).toEqual({
      text: 'mengubah pengeluaran',
      change: [`${rp(50_000)} → ${rp(75_000)}`, 'Makan → Belanja'],
      srText: `dari ${rp(50_000)} menjadi ${rp(75_000)}, dari Makan menjadi Belanja`,
    });
  });

  it('update tanpa perubahan nominal/kategori (keterangan, tanggal, dompet): hanya kalimat', () => {
    const r = row({ op: 'update', beforeAmount: 85_000, beforeCategoryId: 'c-makan' });
    expect(activityText(r, ctx)).toEqual({ text: 'mengubah pengeluaran', change: [] });
    expect(amountChanged(r)).toBe(false);
  });

  it('baris perubahan hanya untuk update', () => {
    for (const op of ['create', 'void', 'restore'] as const) {
      const r = row({ op, amount: 75_000, beforeAmount: 50_000, beforeCategoryId: 'c-belanja' });
      expect(activityText(r, ctx).change).toEqual([]);
      expect(activityText(r, ctx).srText).toBeUndefined();
      expect(amountChanged(r)).toBe(false);
    }
  });
});

describe('activityText: transfer, antar ruang, cocokkan saldo [B3, B6]', () => {
  it('transfer dalam Bersama', () => {
    const t = { kind: 'transfer', categoryId: null } as const;
    expect(activityText(row({ ...t }), ctx).text).toBe('mencatat transfer antar dompet');
    expect(activityText(row({ ...t, description: 'Isi kas' }), ctx).text).toBe(
      'mencatat transfer antar dompet (Isi kas)',
    );
    expect(activityText(row({ ...t, op: 'void', description: 'Isi kas' }), ctx).text).toBe(
      'membatalkan transfer antar dompet',
    );
    expect(activityText(row({ ...t, op: 'restore', description: 'Isi kas' }), ctx).text).toBe(
      'memulihkan transfer antar dompet',
    );
  });

  it('setor ke Bersama (space_transfer in), catatan bersama hanya saat create', () => {
    const s = { kind: 'space_transfer', direction: 'in', categoryId: null } as const;
    expect(activityText(row({ ...s }), ctx).text).toBe('menyetor ke Bersama');
    expect(activityText(row({ ...s, sharedNote: 'Belanja bulanan' }), ctx).text).toBe(
      'menyetor ke Bersama (Belanja bulanan)',
    );
    expect(activityText(row({ ...s, op: 'void', sharedNote: 'x' }), ctx).text).toBe(
      'membatalkan setoran ke Bersama',
    );
    expect(activityText(row({ ...s, op: 'restore', sharedNote: 'x' }), ctx).text).toBe(
      'memulihkan setoran ke Bersama',
    );
  });

  it('ambil dari Bersama (space_transfer out)', () => {
    const s = { kind: 'space_transfer', direction: 'out', categoryId: null } as const;
    expect(activityText(row({ ...s }), ctx).text).toBe('mengambil dari Bersama');
    expect(activityText(row({ ...s, sharedNote: 'Bensin' }), ctx).text).toBe(
      'mengambil dari Bersama (Bensin)',
    );
    expect(activityText(row({ ...s, op: 'void' }), ctx).text).toBe(
      'membatalkan pengambilan dari Bersama',
    );
    expect(activityText(row({ ...s, op: 'restore' }), ctx).text).toBe(
      'memulihkan pengambilan dari Bersama',
    );
  });

  it('kaki antar ruang tidak pernah memakai description (pertahanan berlapis)', () => {
    const r = row({
      kind: 'space_transfer',
      direction: 'in',
      description: 'KANARI-N-SETOR',
      categoryId: null,
    });
    expect(JSON.stringify(activityText(r, ctx))).not.toContain('KANARI');
  });

  it('cocokkan saldo naik/turun; batal dan pulih tanpa arah', () => {
    const a = { kind: 'adjustment', categoryId: null } as const;
    expect(activityText(row({ ...a, direction: 'in' }), ctx).text).toBe('mencocokkan saldo, naik');
    expect(activityText(row({ ...a, direction: 'out' }), ctx).text).toBe(
      'mencocokkan saldo, turun',
    );
    for (const direction of ['in', 'out'] as const) {
      expect(activityText(row({ ...a, direction, op: 'void' }), ctx).text).toBe(
        'membatalkan pencocokan saldo',
      );
      expect(activityText(row({ ...a, direction, op: 'restore' }), ctx).text).toBe(
        'memulihkan pencocokan saldo',
      );
    }
  });
});

describe('activityText: dipindah (R26) dan fallback per op', () => {
  it('void entri yang dipindah: memindahkan transaksi ke ruang lain, tanpa {J}', () => {
    const r = row({ op: 'void', moved: true, description: 'Makan siang', version: 2 });
    expect(activityText(r, ctx)).toEqual({
      text: 'memindahkan transaksi ke ruang lain',
      change: [],
    });
    expect(activityText(row({ ...r, kind: 'income' }), ctx).text).toBe(
      'memindahkan transaksi ke ruang lain',
    );
  });

  it.each([
    ['transfer', 'update', null],
    ['space_transfer', 'update', 'in'],
    ['space_transfer', 'update', 'out'],
    ['adjustment', 'update', 'in'],
    ['space_transfer', 'create', null],
    ['adjustment', 'create', null],
    ['reimbursement', 'create', null],
    ['reimbursement', 'update', null],
    ['reimbursement', 'void', null],
    ['reimbursement', 'restore', null],
    ['opening_balance', 'create', null],
    ['space_transfer', 'void', null],
    ['space_transfer', 'restore', null],
  ] as const)('%s %s (arah %s): fallback menurut op', (kind, op, direction) => {
    const text = {
      create: 'mencatat transaksi',
      update: 'memperbarui transaksi',
      void: 'membatalkan transaksi',
      restore: 'memulihkan transaksi',
    }[op];
    const r = row({ kind, op, direction, description: 'X-DESC', sharedNote: 'X-NOTE' });
    expect(activityText(r, ctx).text).toBe(text);
    expect(JSON.stringify(activityText(r, ctx))).not.toMatch(/X-DESC|X-NOTE/);
  });

  it('fallback update tetap memberi baris perubahan nominal', () => {
    const r = row({ kind: 'transfer', op: 'update', amount: 2, beforeAmount: 1, categoryId: null });
    expect(activityText(r, ctx)).toEqual({
      text: 'memperbarui transaksi',
      change: [`${rp(1)} → ${rp(2)}`],
      srText: `dari ${rp(1)} menjadi ${rp(2)}`,
    });
  });
});

describe('activityText: tanggal mundur hanya create/restore', () => {
  const mundur = { occurredOn: '2026-10-26', at: '2026-11-04T14:05:00+07:00' } as const;

  it.each(['create', 'restore'] as const)('%s dengan occurred_on ≠ hari peristiwa', (op) => {
    expect(activityText(row({ ...mundur, op }), ctx).backdate).toBe('tanggal 26 Okt');
  });

  it.each(['update', 'void'] as const)('%s tidak pernah memakai akhiran', (op) => {
    expect(activityText(row({ ...mundur, op }), ctx)).not.toHaveProperty('backdate');
  });

  it('occurred_on = hari peristiwa (WIB): tanpa akhiran', () => {
    expect(activityText(row({ op: 'create' }), ctx)).not.toHaveProperty('backdate');
    // 23.30 WIB tanggal 31 Okt = 16.30 UTC: hari peristiwa memakai tanggal WIB.
    const malam = row({ occurredOn: '2026-10-31', at: '2026-10-31T23:30:00+07:00' });
    expect(activityText(malam, ctx)).not.toHaveProperty('backdate');
  });

  it('dipindah (void) tidak memakai akhiran', () => {
    expect(activityText(row({ ...mundur, op: 'void', moved: true }), ctx)).not.toHaveProperty(
      'backdate',
    );
  });
});

describe('activityText: batas masukan (K1)', () => {
  it('field tak dikenal tidak memengaruhi teks', () => {
    const r = row({ description: 'Makan siang' });
    const extra = {
      ...r,
      accountId: 'KANARI-ACC',
      accountName: 'KANARI-DOMPET-N',
      linkId: 'KANARI-LINK',
    } as SharedActivityRow;
    expect(activityText(extra, ctx)).toEqual(activityText(r, ctx));
    expect(JSON.stringify(activityText(extra, ctx))).not.toContain('KANARI');
  });

  it('keluaran hanya dari description, shared_note, nama kategori, dan nominal', () => {
    const ops = ['create', 'update', 'void', 'restore'] as const;
    const kinds = [
      'expense',
      'income',
      'transfer',
      'space_transfer',
      'adjustment',
      'reimbursement',
      'opening_balance',
    ] as const;
    for (const op of ops) {
      for (const kind of kinds) {
        for (const direction of ['in', 'out', null] as const) {
          for (const moved of [false, true]) {
            const r = row({
              op,
              kind,
              direction,
              moved,
              categoryId: 'c-belanja',
              beforeCategoryId: 'c-makan',
              amount: 75_000,
              beforeAmount: 50_000,
            });
            const out = JSON.stringify(activityText(r, ctx));
            for (const forbidden of [ENTRY, ACTOR, 'c-belanja', 'c-makan', '2026-11-04T']) {
              expect(out).not.toContain(forbidden);
            }
            expect(out).not.toMatch(/undefined|NaN/);
          }
        }
      }
    }
  });
});
