import 'server-only';
import { formatRupiah } from '@dompetku/domain';
import { z } from 'zod';
import { eksporFilename, eksporPdfFilename } from '@/features/laporan/href';
import { categoryName, excludedLines, groupCategories, pctText } from '@/features/laporan/present';
import { createRateLimiter } from '@/server/wa/ratelimit';
import { toCsv, type ExportRow } from './csv';
import {
  categoriesTx,
  excludedTx,
  type LaporanParams,
  parseLaporanParams,
  periodOf,
  resolveViewed,
  trendTx,
} from './laporan';
import { buildPdf, type PdfTable } from './pdf';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Ekspor CSV dan PDF periode Laporan (S10 Task 7, S16 Task 4, K5/K9/B13). Rentang = periode yang sama
 * dengan Laporan (`?periode=YYYY-MM&basis=gajian|kalender`, divalidasi seperti `loadLaporan`: rusak/di
 * luar jangkauan = periode berjalan), dari `api.period_trend`; isi dari `api.export_entries` (satu baris
 * per kaki entri dari `report_lines`, jadi Σ per kelas = angka Laporan). `statement_timeout` dinaikkan
 * sampai 30 s lokal transaksi sebelum membaca (BSD §15 butir 7); hanya fungsi ini yang menaikkannya.
 * Hanya ruang ini (`assert_member`, B13); event audit `export` ditulis fungsi SQL dengan `via = csv|pdf`.
 */

/** Batas laju: 10 ekspor per jam per user (berbagi CSV + PDF; di memori satu proses). */
export const EXPORT_PER_USER_PER_HOUR = 10;
export const exportLimiter = createRateLimiter(EXPORT_PER_USER_PER_HOUR, 3_600_000);

export interface LaporanExport {
  csv: string;
  filename: string;
  rows: ExportRow[];
}

export interface LaporanPdfExport {
  pdf: Uint8Array;
  filename: string;
  rows: ExportRow[];
  summary: { pemasukan: number; pengeluaran: number; selisih: number };
}

const exportRow = z.object({
  occurred_on: z.string(),
  kind: z.string(),
  role: z.string(),
  report_class: z.string(),
  account: z.string(),
  category: z.string().nullable(),
  subcategory: z.string().nullable(),
  amount: z.number().int(),
  note: z.string().nullable(),
  recorded_by: z.string().nullable(),
  trip: z.string().nullable(),
});

function parseExportRows(raw: Record<string, unknown>[]): ExportRow[] {
  return raw.map((r) => {
    const v = exportRow.parse(r);
    return {
      occurredOn: v.occurred_on,
      kind: v.kind,
      role: v.role,
      reportClass: v.report_class,
      account: v.account,
      category: v.category,
      subcategory: v.subcategory,
      amount: v.amount,
      note: v.note,
      recordedBy: v.recorded_by,
      trip: v.trip,
    };
  });
}

export async function exportLaporanCsv(
  ctx: LedgerCtx & { kind: 'personal' | 'shared' },
  params: LaporanParams = {},
): Promise<LaporanExport> {
  const { label, basis } = parseLaporanParams(params);
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { viewed } = await resolveViewed(c, ctx, label, basis);
    const [, row] = await trendTx(c, ctx, `${viewed}-01`, 2, basis);
    if (!row) throw new Error('period_trend kosong');
    await c.query("select set_config('statement_timeout', '30s', true)");
    const { rows: raw } = await c.query<Record<string, unknown>>(
      `select to_char(x.occurred_on, 'YYYY-MM-DD') as occurred_on, x.kind, x.role, x.report_class,
              x.account, x.category, x.subcategory, x.amount, x.note, x.recorded_by, x.trip
         from api.export_entries(p_space_id => $1, p_from => $2::date, p_to => $3::date, p_via => 'csv') x`,
      [ctx.spaceId, row.from, row.to],
    );
    const rows = parseExportRows(raw);
    return {
      csv: toCsv(rows),
      filename: eksporFilename(ctx.kind === 'shared' ? 'bersama' : 'pribadi', viewed, basis),
      rows,
    };
  });
}

/**
 * Ekspor PDF periode Laporan (S16-PD2): angka ringkasan, kategori, kelas di luar ringkasan, dan daftar
 * transaksi dibaca dalam satu transaksi DB dari fungsi SQL yang sama persis dengan halaman Laporan.
 */
export async function exportLaporanPdf(
  ctx: LedgerCtx & { kind: 'personal' | 'shared' },
  params: LaporanParams = {},
): Promise<LaporanPdfExport> {
  const { label, basis } = parseLaporanParams(params);
  const ruang = ctx.kind === 'shared' ? 'bersama' : 'pribadi';
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { current, viewed } = await resolveViewed(c, ctx, label, basis);
    const [, row] = await trendTx(c, ctx, `${viewed}-01`, 2, basis);
    if (!row) throw new Error('period_trend kosong');
    const period = periodOf(row, viewed, current, basis);
    const categories = await categoriesTx(c, ctx, row.from, row.to);
    const classes = await excludedTx(c, ctx, row.from, row.to);
    await c.query("select set_config('statement_timeout', '30s', true)");
    const { rows: raw } = await c.query<Record<string, unknown>>(
      `select to_char(x.occurred_on, 'YYYY-MM-DD') as occurred_on, x.kind, x.role, x.report_class,
              x.account, x.category, x.subcategory, x.amount, x.note, x.recorded_by, x.trip
         from api.export_entries(p_space_id => $1, p_from => $2::date, p_to => $3::date, p_via => 'pdf') x`,
      [ctx.spaceId, row.from, row.to],
    );
    const rows = parseExportRows(raw);

    const sections: PdfTable[] = [];
    const expBlock = groupCategories(categories, 'expense');
    const groupCount = (g: (typeof expBlock.groups)[number]) =>
      g.root.entryCount + g.children.reduce((n, ch) => n + ch.entryCount, 0);
    if (expBlock.groups.length > 0) {
      sections.push({
        heading: 'Kategori pengeluaran',
        columns: [
          { header: 'Kategori', width: 255, align: 'left' },
          { header: 'Transaksi', width: 70, align: 'right' },
          { header: 'Porsi', width: 65, align: 'right' },
          { header: 'Nominal', width: 125, align: 'right' },
        ],
        rows: expBlock.groups.map((g) => [
          categoryName(g.root),
          String(groupCount(g)),
          pctText(g.root.rootPct10),
          formatRupiah(g.root.rootTotal),
        ]),
        emptyText: 'Belum ada pengeluaran.',
      });
    }
    const incBlock = groupCategories(categories, 'income');
    if (incBlock.groups.length > 0) {
      sections.push({
        heading: 'Kategori pemasukan',
        columns: [
          { header: 'Kategori', width: 255, align: 'left' },
          { header: 'Transaksi', width: 70, align: 'right' },
          { header: 'Porsi', width: 65, align: 'right' },
          { header: 'Nominal', width: 125, align: 'right' },
        ],
        rows: incBlock.groups.map((g) => [
          categoryName(g.root),
          String(groupCount(g)),
          pctText(g.root.rootPct10),
          formatRupiah(g.root.rootTotal),
        ]),
        emptyText: 'Belum ada pemasukan.',
      });
    }
    const excluded = excludedLines(classes, ruang);
    if (excluded.length > 0) {
      sections.push({
        heading: 'Di luar ringkasan',
        columns: [
          { header: 'Kelompok', width: 185, align: 'left' },
          { header: 'Keterangan', width: 205, align: 'left' },
          { header: 'Nominal', width: 125, align: 'right' },
        ],
        rows: excluded.map((e) => [e.name, e.note, formatRupiah(e.amount)]),
        emptyText: 'Tidak ada transaksi di luar ringkasan.',
      });
    }
    sections.push({
      heading: 'Daftar transaksi',
      columns: [
        { header: 'Tanggal', width: 65, align: 'left' },
        { header: 'Dompet', width: 95, align: 'left' },
        { header: 'Kategori', width: 100, align: 'left' },
        { header: 'Catatan', width: 165, align: 'left' },
        { header: 'Nominal', width: 90, align: 'right' },
      ],
      rows: rows.map((r) => {
        const cat = r.subcategory ? `${r.category ?? ''} · ${r.subcategory}` : (r.category ?? '-');
        const noteParts = [r.note, r.trip ? `Trip: ${r.trip}` : null].filter(Boolean);
        return [
          r.occurredOn,
          r.account,
          cat,
          noteParts.length > 0 ? noteParts.join(' · ') : '-',
          formatRupiah(r.amount),
        ];
      }),
      emptyText: 'Belum ada transaksi pada periode ini.',
    });

    const pdf = buildPdf({
      title: `Laporan Dompetku · ${ruang === 'bersama' ? 'Bersama' : 'Pribadi'}`,
      subtitle: `${period.label} (${basis === 'kalender' ? 'Bulan kalender' : 'Periode gajian'})`,
      summary: [
        { label: 'Pemasukan', value: formatRupiah(row.pemasukan) },
        { label: 'Pengeluaran', value: formatRupiah(row.pengeluaran) },
        { label: 'Selisih', value: formatRupiah(row.selisih, { sign: 'always' }) },
      ],
      sections,
    });
    return {
      pdf,
      filename: eksporPdfFilename(ruang, viewed, basis),
      rows,
      summary: { pemasukan: row.pemasukan, pengeluaran: row.pengeluaran, selisih: row.selisih },
    };
  });
}
