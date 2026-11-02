import 'server-only';
import type { EntryVM, MonthSummaryVM } from '@/features/ledger/types';
import { listEntries, monthSummary, recentEntries } from './read';
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
   * "bulan ini kosong". Hanya dikueri bila daftar bulan ini kosong.
   */
  hasAny: boolean;
}

/** `month` = 'YYYY-MM' yang sudah divalidasi page; tidak sah = galat Zod dari loader. */
export async function loadTransaksi(ctx: LedgerCtx, month: string): Promise<TransaksiData> {
  const [entries, summary] = await Promise.all([
    listEntries(ctx, { month }),
    monthSummary(ctx, month),
  ]);
  const hasAny = entries.length > 0 || (await recentEntries(ctx, 1)).length > 0;
  return { entries, summary, hasAny };
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
