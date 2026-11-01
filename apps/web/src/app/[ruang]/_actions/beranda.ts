'use server';

import type { ActionResult } from '@/features/ledger/types';
import { recordProductEvent } from '@/server/ledger/events';
import { markNoSpendDay } from '@/server/ledger/write';
import { actionContext, ledger, mutate, swallow } from './context';

/** Server Action Beranda (endpoint publik; pola di `context.ts`). */

/**
 * "Tidak ada pengeluaran hari ini": tanggal = `app.today()` (WIB server), dua kali = satu baris.
 * Event `tanpa_pengeluaran` dicatat sesudah tanda berhasil dan hanya bila tanda baru (`created`);
 * galat event ditelan, hasil tanda yang dikembalikan.
 */
export async function markNoSpendDayAction(ruang: unknown): Promise<ActionResult<void>> {
  return mutate('markNoSpendDayAction', actionContext(ruang), async (ctx) => {
    const { created } = await markNoSpendDay(ledger(ctx));
    // Tanda ulang di hari yang sama bukan kejadian baru: event hanya untuk tanda baru.
    if (!created) return;
    await swallow('markNoSpendDayAction', () =>
      recordProductEvent(ctx.pools, ctx.userId, {
        event: 'tanpa_pengeluaran',
        spaceKind: ctx.kind,
      }),
    );
  });
}
