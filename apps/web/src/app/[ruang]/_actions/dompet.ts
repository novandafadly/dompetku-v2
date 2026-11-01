'use server';

import type { z } from 'zod';
import type { ActionResult } from '@/features/ledger/types';
import { createAccount, createAccountSchema } from '@/server/ledger/write';
import { actionContext, ledger, mutate, parseInput } from './context';

/** Server Action Dompet (endpoint publik; pola di `context.ts`). */

/** Dompet baru, dibuka hari ini (WIB server); saldo awal 0 = tanpa entri. */
export async function createAccountAction(
  ruang: unknown,
  input: z.input<typeof createAccountSchema>,
): Promise<ActionResult<{ accountId: string }>> {
  return mutate('createAccountAction', actionContext(ruang), async (ctx) =>
    createAccount(ledger(ctx), parseInput(createAccountSchema, input)),
  );
}
