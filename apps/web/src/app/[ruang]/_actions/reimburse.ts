'use server';

import type { z } from 'zod';
import type { ActionResult, ReimbursableVM } from '@/features/ledger/types';
import {
  createReimbursement,
  createReimbursementSchema,
  openReimbursables,
} from '@/server/ledger/reimburse';
import { actionContext, ledger, mutate, parseInput, query } from './context';

/**
 * Server Action talangan kantor dan reimburse (endpoint publik; pola di `context.ts`). Talangan
 * hanya ada di Pribadi; talangan dan dompet penerima wajib di ruang argumen (DK404 bila tidak).
 */

export interface ReimbursementValue {
  entryId: string;
  /** Sisa sesudah reimburse ini saat pertama dicatat (replay tidak memperbarui). */
  remaining: number;
  replayed: boolean;
}

/** Catat reimburse (boleh sebagian); melebihi sisa = `reimbursement_exceeds`. */
export async function createReimbursementAction(
  ruang: unknown,
  input: z.input<typeof createReimbursementSchema>,
): Promise<ActionResult<ReimbursementValue>> {
  return mutate('createReimbursementAction', actionContext(ruang), async (ctx) =>
    createReimbursement(ledger(ctx), parseInput(createReimbursementSchema, input)),
  );
}

/** Talangan yang masih menunggu reimburse; Bersama tidak punya talangan (kosong, tanpa kueri). */
export async function openReimbursablesAction(
  ruang: unknown,
): Promise<ActionResult<ReimbursableVM[]>> {
  return query('openReimbursablesAction', actionContext(ruang), async (ctx) =>
    ctx.kind === 'personal' ? openReimbursables(ledger(ctx)) : [],
  );
}
