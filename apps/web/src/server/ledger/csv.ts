/**
 * CSV ekspor transaksi (S10 Task 7, K5/K9). Murni (tanpa DB): CRLF, kutip RFC 4180, BOM UTF-8 supaya
 * Excel membaca UTF-8, dan escape injeksi rumus: sel teks yang diawali `= + - @` atau TAB/CR diberi
 * awalan `'` (OWASP CSV injection). Kolom nominal bukan teks: harus bilangan bulat polos (`-45000`)
 * yang divalidasi dan TIDAK di-escape, kalau tidak nominal negatif rusak.
 */

export interface ExportRow {
  occurredOn: string;
  kind: string;
  role: string;
  reportClass: string;
  account: string;
  category: string | null;
  subcategory: string | null;
  amount: number;
  note: string | null;
  recordedBy: string | null;
}

export const CSV_HEADER = [
  'Tanggal',
  'Jenis',
  'Peran',
  'Kelas laporan',
  'Dompet',
  'Kategori',
  'Subkategori',
  'Nominal',
  'Catatan',
  'Pencatat',
] as const;

/** BOM UTF-8 (U+FEFF); ditulis sebagai escape agar tidak jadi spasi tak terlihat di sumber. */
const BOM = String.fromCharCode(0xfeff);

const FORMULA_START = /^[=+\-@\t\r]/;

/** Sel teks: escape rumus, lalu kutip bila memuat `"`, `,`, CR, atau LF. */
export function csvText(value: string | null | undefined): string {
  let v = value ?? '';
  if (FORMULA_START.test(v)) v = `'${v}`;
  return /["\r\n,]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

/** Nominal: bilangan bulat aman, ditulis polos; selain itu galat (tidak pernah ditulis diam-diam). */
export function csvAmount(n: number): string {
  if (!Number.isSafeInteger(n)) throw new RangeError('nominal ekspor bukan bilangan bulat');
  return String(n);
}

export function toCsv(rows: readonly ExportRow[]): string {
  const lines = [CSV_HEADER.map(csvText).join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvText(r.occurredOn),
        csvText(r.kind),
        csvText(r.role),
        csvText(r.reportClass),
        csvText(r.account),
        csvText(r.category),
        csvText(r.subcategory),
        csvAmount(r.amount),
        csvText(r.note),
        csvText(r.recordedBy),
      ].join(','),
    );
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
