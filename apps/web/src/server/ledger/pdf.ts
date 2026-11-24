/**
 * Penyusun PDF Laporan (S16 Task 4, K9). Murni (tanpa DB, tanpa dependensi): PDF 1.4, satu fon standar
 * (Helvetica dan Helvetica-Bold, WinAnsi), aliran isi tanpa kompresi, jadi isinya dapat diperiksa tes.
 *
 * Keamanan (K9, SEC-09): semua teks pengguna (nama kategori, dompet, catatan, nama trip) hanya masuk sebagai
 * string literal PDF yang di-escape (`\`, `(`, `)`), karakter kontrol diganti spasi, dan karakter di luar
 * WinAnsi diganti `?`. Tidak ada anotasi, tautan, JavaScript, berkas terlampir, atau aksi: teks yang tampak
 * seperti rumus atau HTML tetap teks mati. Metadata hanya judul dan Producer tetap, tanpa nama orang.
 * Angka uang sudah berupa teks terformat dari SQL (bigint); modul ini tidak menghitung uang.
 */

export interface PdfColumn {
  header: string;
  /** Lebar kolom dalam poin. */
  width: number;
  align: 'left' | 'right';
}

export interface PdfTable {
  heading: string;
  columns: PdfColumn[];
  rows: string[][];
  /** Dipakai bila `rows` kosong. */
  emptyText: string;
}

export interface PdfDocument {
  title: string;
  subtitle: string;
  /** Pasangan label dan nilai (nilai sudah diformat). */
  summary: { label: string; value: string }[];
  sections: PdfTable[];
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN_X = 40;
const MARGIN_TOP = 52;
const MARGIN_BOTTOM = 52;
const ROW_H = 14;

/** Lebar Helvetica per 1000 em untuk ASCII 32..126 (AFM standar). */
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
] as const;

/** Karakter di luar ASCII yang punya kode WinAnsi (cp1252). */
const WIN_ANSI: Record<number, number> = {
  0x2013: 0x96, // en dash
  0x2014: 0x97, // em dash
  0x2022: 0x95, // bullet
  0x2018: 0x27,
  0x2019: 0x27,
  0x201c: 0x22,
  0x201d: 0x22,
  0x2026: 0x85, // elipsis
  0x2212: 0x2d, // minus matematika -> hubung
};

/** Teks pengguna -> kode byte WinAnsi aman (tanpa kontrol, tanpa karakter asing). */
export function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0x3f;
    if (
      cp === 0x09 ||
      cp === 0x0a ||
      cp === 0x0d ||
      cp === 0xa0 ||
      cp < 0x20 ||
      (cp >= 0x7f && cp <= 0x9f)
    ) {
      out.push(0x20);
    } else if (cp <= 0x7e || (cp >= 0xa1 && cp <= 0xff)) {
      out.push(cp);
    } else {
      out.push(WIN_ANSI[cp] ?? 0x3f);
    }
  }
  return out;
}

function glyphWidth(code: number, bold: boolean): number {
  const w = code >= 32 && code <= 126 ? (HELV[code - 32] ?? 556) : code === 0xb7 ? 278 : 556;
  return bold ? w * 1.06 : w;
}

/** Lebar teks dalam poin. */
export function textWidth(codes: readonly number[], size: number, bold = false): number {
  let sum = 0;
  for (const c of codes) sum += glyphWidth(c, bold);
  return (sum * size) / 1000;
}

/** Potong sampai muat `maxWidth`; bila terpotong diakhiri `...`. */
export function fitText(text: string, maxWidth: number, size: number, bold = false): number[] {
  const codes = toWinAnsi(text);
  if (textWidth(codes, size, bold) <= maxWidth) return codes;
  const dots = [0x2e, 0x2e, 0x2e];
  const budget = maxWidth - textWidth(dots, size, bold);
  const kept: number[] = [];
  let w = 0;
  for (const c of codes) {
    const cw = (glyphWidth(c, bold) * size) / 1000;
    if (w + cw > budget) break;
    kept.push(c);
    w += cw;
  }
  while (kept.length > 0 && kept[kept.length - 1] === 0x20) kept.pop();
  return [...kept, ...dots];
}

/** Escape string literal PDF: `\`, `(` dan `)`; karakter kontrol diganti spasi. */
export function pdfString(codes: readonly number[]): string {
  let s = '(';
  for (const raw of codes) {
    const b = raw & 0xff;
    const c = b < 0x20 || b === 0x7f ? 0x20 : b;
    if (c === 0x5c || c === 0x28 || c === 0x29) s += '\\';
    s += String.fromCharCode(c);
  }
  return `${s})`;
}

const n2 = (n: number): string => (Math.round(n * 100) / 100).toString();

class Pages {
  private readonly pages: string[][] = [[]];
  y = PAGE_H - MARGIN_TOP;

  get count(): number {
    return this.pages.length;
  }

  newPage(): void {
    this.pages.push([]);
    this.y = PAGE_H - MARGIN_TOP;
  }

  ensure(height: number, onNew?: () => void): void {
    if (this.y - height < MARGIN_BOTTOM) {
      this.newPage();
      onNew?.();
    }
  }

  private cur(): string[] {
    const p = this.pages[this.pages.length - 1];
    if (!p) throw new Error('halaman kosong');
    return p;
  }

  text(
    x: number,
    y: number,
    codes: readonly number[],
    size: number,
    opts: { bold?: boolean; align?: 'left' | 'right'; gray?: number } = {},
  ): void {
    const bold = opts.bold ?? false;
    const w = textWidth(codes, size, bold);
    const px = opts.align === 'right' ? x - w : x;
    const gray = opts.gray ?? 0;
    this.cur().push(
      `${n2(gray)} g BT /${bold ? 'F2' : 'F1'} ${n2(size)} Tf ${n2(px)} ${n2(y)} Td ${pdfString(codes)} Tj ET`,
    );
  }

  rule(y: number, gray = 0.75): void {
    this.cur().push(
      `${n2(gray)} G 0.5 w ${n2(MARGIN_X)} ${n2(y)} m ${n2(PAGE_W - MARGIN_X)} ${n2(y)} l S`,
    );
  }

  streams(): string[] {
    return this.pages.map((p) => p.join('\n'));
  }
}

function drawTable(pg: Pages, t: PdfTable): void {
  const header = (): void => {
    let x = MARGIN_X;
    for (const col of t.columns) {
      const codes = fitText(col.header, col.width - 4, 8, true);
      pg.text(col.align === 'right' ? x + col.width : x, pg.y, codes, 8, {
        bold: true,
        align: col.align,
        gray: 0.3,
      });
      x += col.width;
    }
    pg.y -= 4;
    pg.rule(pg.y);
    pg.y -= ROW_H - 4;
  };
  pg.ensure(40);
  pg.text(MARGIN_X, pg.y, toWinAnsi(t.heading), 11, { bold: true });
  pg.y -= 16;
  if (t.rows.length === 0) {
    pg.text(MARGIN_X, pg.y, toWinAnsi(t.emptyText), 9, { gray: 0.35 });
    pg.y -= ROW_H + 8;
    return;
  }
  header();
  for (const row of t.rows) {
    pg.ensure(ROW_H, header);
    let x = MARGIN_X;
    t.columns.forEach((col, i) => {
      const codes = fitText(row[i] ?? '', col.width - 6, 8.5);
      pg.text(col.align === 'right' ? x + col.width - 2 : x, pg.y, codes, 8.5, {
        align: col.align,
      });
      x += col.width;
    });
    pg.y -= ROW_H;
  }
  pg.y -= 10;
}

/** Susun dokumen PDF Laporan. Hasil = bita latin1 (struktur PDF + isi WinAnsi). */
export function buildPdf(doc: PdfDocument): Uint8Array {
  const pg = new Pages();
  pg.text(MARGIN_X, pg.y, toWinAnsi(doc.title), 16, { bold: true });
  pg.y -= 18;
  pg.text(MARGIN_X, pg.y, toWinAnsi(doc.subtitle), 10, { gray: 0.3 });
  pg.y -= 20;
  for (const s of doc.summary) {
    pg.text(MARGIN_X, pg.y, toWinAnsi(s.label), 10);
    pg.text(MARGIN_X + 230, pg.y, toWinAnsi(s.value), 10, { bold: true, align: 'right' });
    pg.y -= 15;
  }
  pg.y -= 12;
  for (const t of doc.sections) drawTable(pg, t);

  // Kaki halaman: nomor halaman (butuh jumlah halaman akhir, jadi dilampirkan sesudah tata letak).
  const total = pg.count;
  const streams = pg.streams().map((body, i) => {
    const foot = new Pages();
    foot.text(MARGIN_X, 28, toWinAnsi('Dompetku'), 8, { gray: 0.45 });
    foot.text(
      PAGE_W - MARGIN_X,
      28,
      toWinAnsi(`Halaman ${String(i + 1)} dari ${String(total)}`),
      8,
      { align: 'right', gray: 0.45 },
    );
    return `${body}\n${foot.streams()[0] ?? ''}`;
  });

  // Objek: 1 katalog, 2 pohon halaman, 3 Helvetica, 4 Helvetica-Bold, 5 info, lalu pasangan (halaman, isi).
  const objs: string[] = [];
  const pageIds = streams.map((_, i) => 6 + i * 2);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(total)} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objs[5] = `<< /Title ${pdfString(fitText(doc.title, 400, 10))} /Producer (Dompetku) >>`;
  streams.forEach((body, i) => {
    const pid = pageIds[i] ?? 0;
    objs[pid] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE_W)} ${String(PAGE_H)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${String(pid + 1)} 0 R >>`;
    objs[pid + 1] = `<< /Length ${String(body.length)} >>\nstream\n${body}\nendstream`;
  });

  let out = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n';
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${String(id)} 0 obj\n${objs[id] ?? ''}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${String(objs.length)}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) {
    out += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${String(objs.length)} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Uint8Array.from(out, (ch) => ch.charCodeAt(0) & 0xff);
}
