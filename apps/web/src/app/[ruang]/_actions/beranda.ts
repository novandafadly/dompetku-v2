'use server';

import type { ActionResult } from '@/features/ledger/types';
import { recordProductEvent } from '@/server/ledger/events';
import { markNoSpendDay } from '@/server/ledger/write';
import { actionContext, ledger, mutate, swallow } from './context';

/** Server Action Beranda (endpoint publik; pola di `context.ts`). */

/**
 * "Tidak ada pengeluaran hari ini": tanggal = `app.today()` (WIB server), dua kali = satu baris.
 * Event `tanpa_pengeluaran` dicatat sesudah tanda berhasil; galat event ditelan, hasil tanda yang
 * dikembalikan.
 */
export async function markNoSpendDayAction(ruang: unknown): Promise<ActionResult<void>> {
  return mutate('markNoSpendDayAction', actionContext(ruang), async (ctx) => {
    await markNoSpendDay(ledger(ctx));
    await swallow('markNoSpendDayAction', () =>
      recordProductEvent(ctx.pools, ctx.userId, {
        event: 'tanpa_pengeluaran',
        spaceKind: ctx.kind,
      }),
    );
  });
}
