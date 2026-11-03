'use server';

import type { z } from 'zod';
import type { ActionResult } from '@/features/ledger/types';
import {
  archiveAccount,
  archiveAccountSchema,
  createAccount,
  createAccountSchema,
  reconcileBalance,
  reconcileBalanceSchema,
} from '@/server/ledger/write';
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

export interface ReconcileValue {
  /** Entri `adjustment` baru; `null` bila selisih 0 (tanpa entri). */
  entryId: string | null;
  /** Saldo nyata − saldo tercatat (bertanda). */
  difference: number;
  replayed: boolean;
}

/** Cocokkan saldo: tanggal = hari ini WIB server; "Coba lagi" dengan `clientId` sama = replay. */
export async function reconcileAction(
  ruang: unknown,
  input: z.input<typeof reconcileBalanceSchema>,
): Promise<ActionResult<ReconcileValue>> {
  return mutate('reconcileAction', actionContext(ruang), async (ctx) =>
    reconcileBalance(ledger(ctx), parseInput(reconcileBalanceSchema, input)),
  );
}

/** Arsip dompet: hanya saldo 0 (`balance_not_zero`); idempoten secara alami. */
export async function archiveAccountAction(
  ruang: unknown,
  accountId: unknown,
): Promise<ActionResult<{ archived: boolean }>> {
  return mutate('archiveAccountAction', actionContext(ruang), async (ctx) =>
    archiveAccount(ledger(ctx), parseInput(archiveAccountSchema, { accountId }).accountId),
  );
}
