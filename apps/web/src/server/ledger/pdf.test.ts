import { describe, expect, it } from 'vitest';
import { buildPdf, fitText, pdfString, toWinAnsi } from './pdf';

const asLatin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('pdf (K9 escape dan struktur PDF 1.4)', () => {
  it('[K9] escape backslash, kurung buka/tutup, dan karakter kontrol', () => {
    const raw = 'a(b)c\\d\ne\rf\tg\x00h';
    expect(pdfString(toWinAnsi(raw))).toBe('(a\\(b\\)c\\\\d e f g h)');
    expect(pdfString([0x100, 0x17f, 0x41])).toBe('(  A)');
  });

  it('[K9] menormalkan NBSP dan minus matematika; karakter asing -> ?', () => {
    const codes = toWinAnsi('−Rp\u00a050.000 · 🎉');
    expect(Buffer.from(codes).toString('latin1')).toBe('-Rp 50.000 \xb7 ?');
  });

  it('[K9] muatan injeksi PDF, HTML, dan rumus tetap jadi teks literal tanpa aksi PDF', () => {
    const evil = 'x) Tj ET >> /OpenAction << /S /JavaScript /JS (alert(1)) >> (';
    const bytes = buildPdf({
      title: 'Laporan Dompetku · Pribadi',
      subtitle: 'November 2026',
      summary: [{ label: 'Pengeluaran', value: 'Rp\u00a050.000' }],
      sections: [
        {
          heading: 'Daftar transaksi',
          columns: [
            { header: 'Catatan', width: 400, align: 'left' },
            { header: 'Nominal', width: 115, align: 'right' },
          ],
          rows: [
            [evil, '-Rp\u00a050.000'],
            ['<script>alert(1)</script>', '-Rp\u00a010.000'],
            ['=SUM(A1:A2);+cmd', '-Rp\u00a05.000'],
          ],
          emptyText: 'Belum ada transaksi.',
        },
      ],
    });
    const text = asLatin1(bytes);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
    // Kurung pada muatan berbahaya sudah di-escape sehingga tidak bisa keluar dari string literal.
    expect(text).toContain(
      'x\\) Tj ET >> /OpenAction << /S /JavaScript /JS \\(alert\\(1\\)\\) >> \\(',
    );
    // Tidak ada dictionary aksi atau anotasi di objek PDF (hanya di dalam literal ter-escape).
    expect(text).not.toMatch(/\/Type\s+\/Annot/);
    expect(text).not.toContain('/EmbeddedFile');
    expect(text).not.toContain('/Launch');
    expect(text).not.toContain('/URI');
    expect(text).toContain('(<script>alert\\(1\\)</script>)');
    expect(text).toContain('(=SUM\\(A1:A2\\);+cmd)');
  });

  it('memotong teks panjang dengan elipsis agar tidak meluber kolom', () => {
    const fitted = fitText(
      'Deskripsi transaksi sangat panjang sekali melebihi lebar kolom',
      60,
      8.5,
    );
    const out = Buffer.from(fitted).toString('latin1');
    expect(out.endsWith('...')).toBe(true);
    expect(out.length).toBeLessThan(25);
  });

  it('membagi multi-halaman dan offset xref tepat menunjuk tiap objek', () => {
    const rows = Array.from({ length: 80 }, (_, i) => [
      `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
      `Transaksi ke-${String(i + 1)}`,
      `-Rp\u00a0${String((i + 1) * 1000)}`,
    ]);
    const bytes = buildPdf({
      title: 'Laporan Dompetku · Pribadi',
      subtitle: 'November 2026',
      summary: [
        { label: 'Pemasukan', value: 'Rp\u00a010.000.000' },
        { label: 'Pengeluaran', value: 'Rp\u00a04.000.000' },
      ],
      sections: [
        {
          heading: 'Daftar transaksi',
          columns: [
            { header: 'Tanggal', width: 70, align: 'left' },
            { header: 'Catatan', width: 320, align: 'left' },
            { header: 'Nominal', width: 125, align: 'right' },
          ],
          rows,
          emptyText: 'Kosong',
        },
      ],
    });
    const text = asLatin1(bytes);
    expect(text).toContain('/Count 2');
    expect(text).toContain('(Halaman 1 dari 2)');
    expect(text).toContain('(Halaman 2 dari 2)');

    // Verifikasi setiap entri xref menunjuk tepat ke `<id> 0 obj`.
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(startxref).toBeGreaterThan(0);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const xrefLines = text.slice(startxref).split('\n').slice(3);
    let objId = 1;
    for (const line of xrefLines) {
      if (!/^\d{10} 00000 n $/.test(line)) break;
      const off = Number(line.slice(0, 10));
      expect(text.slice(off, off + `${String(objId)} 0 obj`.length)).toBe(`${String(objId)} 0 obj`);
      objId++;
    }
    expect(objId).toBe(10); // 1..5 + 2 halaman * 2 = 9 objek
  });
});
