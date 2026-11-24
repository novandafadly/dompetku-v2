'use server';

import type { z } from 'zod';
import type { ActionResult } from '@/features/ledger/types';
import { dismissSubscription, dismissSubscriptionSchema } from '@/server/ledger/langganan';
import { actionContext, ledger, mutate, parseInput } from './context';

/** Abaikan satu saran langganan (per nama ternormalisasi + nominal di ruang ini; idempoten). */
export async function dismissSubscriptionAction(
  ruang: unknown,
  input: z.input<typeof dismissSubscriptionSchema>,
): Promise<ActionResult<{ dismissed: boolean }>> {
  return mutate('dismissSubscriptionAction', actionContext(ruang), async (ctx) =>
    dismissSubscription(ledger(ctx), parseInput(dismissSubscriptionSchema, input)),
  );
}
