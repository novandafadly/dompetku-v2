import 'server-only';
import type { EntryVM, MonthSummaryVM } from '@/features/ledger/types';
import { listEntries, monthSummary } from './read';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Data Transaksi nyata untuk satu ruang dan satu bulan WIB (page `[ruang]/transaksi`, sesudah
 * `requireDataUser` dan `resolveSpace`). Hanya data ruang ini: hasilnya diserialisasi ke payload
 * RSC, jadi rute Bersama tidak pernah membawa data Pribadi. Progres anggaran belum dimuat (S9).
 */
export interface TransaksiData {
  /** Entri hidup bulan ini (maks. 1000, terbaru dulu). */
  entries: EntryVM[];
  summary: MonthSummaryVM;
  /**
   * Ruang ini pernah punya entri hidup (bulan apa pun): membedakan "kosong pertama kali" dari
   * "bulan ini kosong".
   */
  hasAny: boolean;
  /**
   * Bulan 'YYYY-MM' dompet paling awal dibuka, termasuk dompet terarsip (entri tidak bisa
   * sebelum dompetnya dibuka); `null` bila ruang belum punya dompet. Batas bawah navigasi bulan.
   */
  firstMonth: string | null;
}

/** Penanda ruang: dompet paling awal (termasuk terarsip) dan ada tidaknya entri hidup. */
async function spaceMarks(ctx: LedgerCtx): Promise<{ firstMonth: string | null; hasAny: boolean }> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<{ first_month: string | null; has_any: boolean }>(
      `select (select to_char(min(a.opened_on), 'YYYY-MM') from app.accounts a
                where a.space_id = $1) as first_month,
              exists (select 1 from app.entries e
                       where e.space_id = $1 and e.voided_at is null) as has_any`,
      [ctx.spaceId],
    );
    const r = rows[0];
    return { firstMonth: r?.first_month ?? null, hasAny: r?.has_any ?? false };
  });
}

/** `month` = 'YYYY-MM' yang sudah divalidasi page; tidak sah = galat Zod dari loader. */
export async function loadTransaksi(ctx: LedgerCtx, month: string): Promise<TransaksiData> {
  const [entries, summary, marks] = await Promise.all([
    listEntries(ctx, { month }),
    monthSummary(ctx, month),
    spaceMarks(ctx),
  ]);
  return { entries, summary, ...marks };
}

const SAFE_TAG = /^[A-Za-z0-9_]{1,64}$/;

/** Kode galat untuk log (SQLSTATE/errno atau nama), tanpa pesan yang bisa memuat data. */
export function errorTag(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const { code, name } = e as { code?: unknown; name?: unknown };
    if (typeof code === 'string' && SAFE_TAG.test(code)) return code;
    if (typeof name === 'string' && SAFE_TAG.test(name)) return name;
  }
  return 'unknown';
}
