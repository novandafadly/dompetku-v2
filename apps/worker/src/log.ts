/**
 * Log baris JSON ke stdout. Field sengaja tertutup: hanya nama job, kode galat (SQLSTATE,
 * `timeout`, `unknown`, `abandoned`, `provider_*`), id cek DQ + severity + jumlah pelanggaran, jumlah
 * baris yatim, dan jumlah harga (S14). Tidak pernah `err.message`, nominal, deskripsi, id entri,
 * email, URL, kunci penyedia, atau kode saham.
 */
export interface LogFields {
  job?: string;
  code?: string;
  status?: 'ok' | 'failed';
  check?: 'dq' | 'jobs';
  ping?: 'start' | 'ok' | 'fail';
  /** Baris `DQxx severity n` untuk cek dengan pelanggaran > 0. */
  dq?: string[];
  count?: number;
  /** Nama variabel env yang tidak valid (bukan nilainya). */
  fields?: string[];
  /** price_refresh dilewati: tanpa penyedia, bursa tutup, atau harga hari ini sudah ada. */
  reason?: 'no_provider' | 'market_closed' | 'done_today';
  /** Jumlah kode yang dipegang (tanpa kodenya) dan hasil jobs.price_ingest. */
  targets?: number;
  prices?: { ok: number; held: number; rejected: number; skipped: number };
}

export type LogFn = (event: string, fields?: LogFields) => void;

export const log: LogFn = (event, fields) => {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), event, ...fields })}\n`);
};
