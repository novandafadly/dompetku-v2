import { z } from 'zod';
import type { LogFn } from './log';
import { MAX_TICKERS, ProviderError, type PriceSource } from './price-source';
import type { Queryable } from './run-job';

/**
 * Hari ini (WIB, app.today) dan apakah job perlu jalan: bursa tutup (Sabtu/Minggu atau
 * app.holidays) atau run price_refresh hari ini sudah menulis harga (run 19:30 sesudah 16:30 sukses).
 * `early`: sebelum 16:15 WIB bursa belum tutup, jadi sumber hanya punya harga berjalan, bukan penutupan
 * (run jadwal yang terlewat dan baru jalan pagi hari, atau pemicu manual, tidak boleh menyimpannya sebagai
 * harga penutupan dan mengunci hari itu).
 */
const STATE_SQL = `select app.today()::text as on,
  extract(isodow from app.today()) > 5
    or exists (select 1 from app.holidays h where h.on_date = app.today()) as closed,
  exists (select 1 from jobs.job_runs r
           where r.job = 'price_refresh' and r.status = 'ok' and r.rows > 0
             and r.started_at >= app.today()::timestamp at time zone 'Asia/Jakarta') as done,
  (app.now() at time zone 'Asia/Jakarta')::time < time '16:15' as early`;

const State = z.tuple([
  z.object({
    on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    closed: z.boolean(),
    done: z.boolean(),
    early: z.boolean(),
  }),
]);
const Targets = z.array(z.object({ ticker: z.string().regex(/^[A-Z]{4}$/) })).max(10_000);
// Nilai (kode sah, harga bulat 1..10^9) divalidasi ulang jobs.price_ingest; di sini hanya bentuknya.
const Quotes = z.array(z.object({ ticker: z.string(), close: z.number() })).max(MAX_TICKERS);
const Counts = z.object({
  ok: z.number().int().min(0),
  held: z.number().int().min(0),
  rejected: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
const Ingest = z.tuple([z.object({ r: Counts })]);

export class PriceShapeError extends Error {}

/**
 * price_targets → sumber → price_ingest, per 100 kode. Mengembalikan jumlah harga tertulis (ok +
 * held) untuk job_runs.rows. Galat penyedia dilempar sebagai ProviderError (run `failed` dengan
 * kodenya); batch yang sudah masuk tetap, harga lama tetap dipakai web.
 */
export async function refreshPrices(
  pool: Queryable,
  source: PriceSource,
  log: LogFn,
): Promise<number> {
  const state = State.safeParse((await pool.query(STATE_SQL)).rows);
  if (!state.success) throw new PriceShapeError();
  const [{ on, closed, done, early }] = state.data;
  if (closed || done || early) {
    log('price_skipped', {
      job: 'price_refresh',
      reason: closed ? 'market_closed' : early ? 'before_close' : 'done_today',
    });
    return 0;
  }

  const targets = Targets.safeParse(
    (await pool.query('select ticker from jobs.price_targets()')).rows,
  );
  if (!targets.success) throw new PriceShapeError();
  const tickers = targets.data.map((t) => t.ticker);

  const total = { ok: 0, held: 0, rejected: 0, skipped: 0 };
  for (let i = 0; i < tickers.length; i += MAX_TICKERS) {
    const chunk = tickers.slice(i, i + MAX_TICKERS);
    const quotes = Quotes.safeParse(await source.fetchClose(chunk, on));
    if (!quotes.success) throw new ProviderError('provider_shape');
    const wanted = new Set(chunk);
    const rows = quotes.data.filter((q) => wanted.has(q.ticker));
    if (rows.length === 0) continue;
    const res = Ingest.safeParse(
      (
        await pool.query('select jobs.price_ingest($1::date, $2::jsonb) as r', [
          on,
          JSON.stringify(rows),
        ])
      ).rows,
    );
    if (!res.success) throw new PriceShapeError();
    const [{ r: c }] = res.data;
    total.ok += c.ok;
    total.held += c.held;
    total.rejected += c.rejected;
    total.skipped += c.skipped;
  }
  log('price_ingested', { job: 'price_refresh', targets: tickers.length, prices: total });
  return total.ok + total.held;
}
