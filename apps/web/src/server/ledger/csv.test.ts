import { describe, expect, it } from 'vitest';
import { csvAmount, csvText, toCsv, type ExportRow } from './csv';

describe('csvText: escape rumus (K9) dan kutip RFC 4180', () => {
  it.each([
    ['=HYPERLINK("http://x")', `"'=HYPERLINK(""http://x"")"`],
    ['@SUM(1+1)', `'@SUM(1+1)`],
    ['+1', `'+1`],
    ['-1', `'-1`],
    ["=cmd|' /C calc'!A0", `'=cmd|' /C calc'!A0`],
    ['\tTab', `'\tTab`],
    ['\rCR', `"'\rCR"`],
    ['tidak =rumus', 'tidak =rumus'],
    [`x;=cmd|' /C calc'!A0`, `x;'=cmd|' /C calc'!A0`],
    ['a;+1;-2', `a;'+1;'-2`],
    ['a; =spasi dulu', 'a; =spasi dulu'],
    ['a,=1', '"a,=1"'],
    ['a,b', '"a,b"'],
    ['dia berkata "hai"', '"dia berkata ""hai"""'],
    ['baris1\nbaris2', '"baris1\nbaris2"'],
    ['', ''],
  ])('%j', (input, out) => {
    expect(csvText(input)).toBe(out);
  });
  it('null dan undefined = sel kosong', () => {
    expect(csvText(null)).toBe('');
    expect(csvText(undefined)).toBe('');
  });
  it('nama dompet berawalan = tetap dinetralkan', () => {
    expect(csvText('=BCA')).toBe(`'=BCA`);
  });
});

describe('csvAmount: bilangan bulat polos, tidak di-escape', () => {
  it("negatif tetap -45000 (bukan '-45000)", () => {
    expect(csvAmount(-45_000)).toBe('-45000');
    expect(csvAmount(0)).toBe('0');
    expect(csvAmount(12_345_678_900)).toBe('12345678900');
  });
  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60])('%s ditolak', (n) => {
    expect(() => csvAmount(n)).toThrow(RangeError);
  });
});

describe('toCsv', () => {
  const row = (over: Partial<ExportRow> = {}): ExportRow => ({
    occurredOn: '2026-11-03',
    kind: 'expense',
    role: 'main',
    reportClass: 'expense',
    account: 'GoPay',
    category: 'Transportasi',
    subcategory: 'Ojek',
    amount: -45_000,
    note: null,
    recordedBy: 'Novanda',
    ...over,
  });

  it('BOM UTF-8, judul kolom, CRLF di akhir tiap baris', () => {
    const csv = toCsv([row()]);
    expect(
      csv.startsWith(
        '﻿Tanggal,Jenis,Peran,Kelas laporan,Dompet,Kategori,Subkategori,Nominal,Catatan,Pencatat\r\n',
      ),
    ).toBe(true);
    expect(csv.endsWith('Transportasi,Ojek,-45000,,Novanda\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(3);
  });
  it('tanpa baris = hanya judul', () => {
    expect(toCsv([]).split('\r\n')).toEqual([expect.stringContaining('Tanggal'), '']);
  });
  it('sel berbahaya dari data (catatan, dompet, kategori, pencatat) dinetralkan; nominal tidak', () => {
    const csv = toCsv([
      row({
        note: '=1+1',
        account: '@x',
        category: '+y',
        subcategory: '-z',
        recordedBy: '=A1',
        amount: -1,
      }),
    ]);
    expect(csv).toContain(`,'@x,'+y,'-z,-1,'=1+1,'=A1\r\n`);
  });
  it('catatan dengan koma, kutip, dan baris baru tetap satu sel', () => {
    const csv = toCsv([row({ note: 'a,"b"\nc' })]);
    expect(csv).toContain(',"a,""b""\nc",');
  });
});
