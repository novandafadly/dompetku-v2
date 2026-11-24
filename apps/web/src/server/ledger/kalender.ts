import 'server-only';
import { z } from 'zod';
import type {
  KalenderBillVM,
  KalenderData,
  KalenderDayVM,
  KalenderDays,
} from '@/features/rencana/types';
import { withLedger } from './retry';
import type { LedgerCtx } from './write';

/**
 * Loader Kalender arus kas (S16 Task 4, K1–K3). Membaca `api.cashflow_calendar(ruang, hari)`
 * (INVOKER STABLE, `assert_member`, hanya ruang ini, B13). Seluruh nominal (`opening`, `bills_amount`,
 * `closing`, `total_bills_amount`, `lowest_balance`) dihitung di SQL (`bigint`); TypeScript tidak
 * menjumlah atau mengurangi uang.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const billSchema = z.object({
  bill_id: z.guid(),
  name: z.string(),
  amount: z.number().int(),
  due_on: isoDate,
  overdue: z.boolean(),
  projected: z.boolean(),
});

const calendarRowSchema = z.object({
  day: isoDate,
  opening: z.number().int(),
  bills_amount: z.number().int(),
  bills_count: z.number().int(),
  overdue_count: z.number().int(),
  closing: z.number().int(),
  short: z.boolean(),
  bills: z.array(billSchema),
  total_bills_amount: z.number().int(),
  total_bills_count: z.number().int(),
  lowest_balance: z.number().int(),
});

/** Nilai jendela URL (`?hari=30|60|90`); nilai selain itu jatuh ke bawaan 30 hari. */
export function parseKalenderDays(raw: string | string[] | undefined): KalenderDays {
  const s = typeof raw === 'string' ? raw : undefined;
  if (s === '60') return 60;
  if (s === '90') return 90;
  return 30;
}

export async function loadKalender(
  ctx: LedgerCtx,
  daysWindow: KalenderDays = 30,
): Promise<KalenderData> {
  return withLedger(ctx.pools, ctx.userId, ctx.spaceId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select to_char(x.day, 'YYYY-MM-DD') as day,
              x.opening, x.bills_amount, x.bills_count, x.overdue_count,
              x.closing, x.short, x.bills,
              sum(x.bills_amount) over ()::bigint as total_bills_amount,
              sum(x.bills_count) over ()::int as total_bills_count,
              min(x.closing) over ()::bigint as lowest_balance
         from api.cashflow_calendar(p_space_id => $1, p_days => $2::int) x
        order by x.day`,
      [ctx.spaceId, daysWindow],
    );
    const parsed = rows.map((r) => calendarRowSchema.parse(r));
    const first = parsed[0];
    if (!first) throw new Error('cashflow_calendar kosong');
    const days: KalenderDayVM[] = parsed.map((r) => ({
      day: r.day,
      opening: r.opening,
      billsAmount: r.bills_amount,
      billsCount: r.bills_count,
      overdueCount: r.overdue_count,
      closing: r.closing,
      short: r.short,
      bills: r.bills.map((b): KalenderBillVM => ({
        billId: b.bill_id,
        name: b.name,
        amount: b.amount,
        dueOn: b.due_on,
        overdue: b.overdue,
        projected: b.projected,
      })),
    }));
    const lowestRow = days.find((d) => d.closing === first.lowest_balance) ?? days[0];
    const firstShort = days.find((d) => d.short) ?? null;
    return {
      daysWindow,
      today: first.day,
      startBalance: first.opening,
      lowestBalance: first.lowest_balance,
      lowestDay: lowestRow ? lowestRow.day : first.day,
      firstShortDay: firstShort ? firstShort.day : null,
      totalBillsCount: first.total_bills_count,
      totalBillsAmount: first.total_bills_amount,
      days,
    };
  });
}
