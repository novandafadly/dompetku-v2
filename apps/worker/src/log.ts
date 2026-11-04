/**
 * Log baris JSON ke stdout. Field sengaja tertutup: hanya nama job, kode galat (SQLSTATE,
 * `timeout`, `unknown`, `abandoned`), id cek DQ + severity + jumlah pelanggaran, dan jumlah
 * baris yatim. Tidak pernah `err.message`, nominal, deskripsi, id entri, email, atau URL.
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
}

export type LogFn = (event: string, fields?: LogFields) => void;

export const log: LogFn = (event, fields) => {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), event, ...fields })}\n`);
};
