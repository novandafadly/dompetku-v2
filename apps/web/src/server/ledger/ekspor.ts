import 'server-only';
import { z } from 'zod';
import { eksporFilename } from '@/features/laporan/href';
import { createRateLimiter } from '@/server/wa/ratelimit';
import { toCsv, type ExportRow } from './csv';
import { type LaporanParams, parseLaporanParams, resolveViewed, trendTx } from './laporan';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Ekspor CSV periode Laporan (S10 Task 7, K5). Rentang = periode yang sama dengan Laporan
 * (`?periode=YYYY-MM&basis=gajian|kalender`, divalidasi seperti `loadLaporan`: rusak/di luar
 * jangkauan = periode berjalan), dari `api.period_trend`; isi dari `api.export_entries` (satu baris
 * per kaki entri dari `report_lines`, jadi Σ per kelas = angka Laporan). `statement_timeout` dinaikkan
 * sampai 30 s lokal transaksi sebelum membaca (BSD §15 butir 7); hanya fungsi ini yang menaikkannya.
 * Hanya ruang ini (`assert_member`, B13); event audit `export` ditulis fungsi SQL (tanpa isi).
 */

/** Batas laju: 10 ekspor per jam per user (satu ekspor = satu event audit + kueri sampai 30 s); di memori satu proses. */
export const EXPORT_PER_USER_PER_HOUR = 10;
export const exportLimiter = createRateLimiter(EXPORT_PER_USER_PER_HOUR, 3_600_000);

export interface LaporanExport {
  csv: string;
  filename: string;
  rows: ExportRow[];
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
});

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
              x.account, x.category, x.subcategory, x.amount, x.note, x.recorded_by
         from api.export_entries(p_space_id => $1, p_from => $2::date, p_to => $3::date) x`,
      [ctx.spaceId, row.from, row.to],
    );
    const rows: ExportRow[] = raw.map((r) => {
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
      };
    });
    return {
      csv: toCsv(rows),
      filename: eksporFilename(ctx.kind === 'shared' ? 'bersama' : 'pribadi', viewed, basis),
      rows,
    };
  });
}
