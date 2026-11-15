'use server';

import type { z } from 'zod';
import type { ActionResult } from '@/features/ledger/types';
import type { GoalStatus } from '@/features/tujuan/types';
import {
  archiveGoal,
  completeGoal,
  createGoal,
  createGoalSchema,
  goalIdSchema,
  restoreGoal,
  updateGoal,
  updateGoalSchema,
  type CreateGoalValue,
} from '@/server/ledger/tujuan';
import { actionContext, ledger, mutate, parseInput } from './context';

/**
 * Server Action Tujuan tabungan (S13; endpoint publik, pola di `context.ts`). Kedua ruang; di Bersama
 * semua anggota boleh menulis (K1). Galat = kode tanpa nominal/nama (`goal_exists`, `goal_not_reached`,
 * …); salinan dipilih UI (`features/tujuan/galat.ts`). `Urungkan` Selesaikan/Arsipkan = `restoreGoalAction`.
 */

/** Tujuan baru (`clientId` stabil per pembukaan sheet: klik ganda/Coba lagi = replay). */
export async function createGoalAction(
  ruang: unknown,
  input: z.input<typeof createGoalSchema>,
): Promise<ActionResult<CreateGoalValue>> {
  return mutate('createGoalAction', actionContext(ruang), async (ctx) =>
    createGoal(ledger(ctx), parseInput(createGoalSchema, input)),
  );
}

/** Ubah nama, target, tanggal target (`null` = hapus); dompet tidak bisa diganti. */
export async function updateGoalAction(
  ruang: unknown,
  input: z.input<typeof updateGoalSchema>,
): Promise<ActionResult<{ goalId: string }>> {
  return mutate('updateGoalAction', actionContext(ruang), async (ctx) =>
    updateGoal(ledger(ctx), parseInput(updateGoalSchema, input)),
  );
}

/** Selesaikan tujuan yang tercapai (membebaskan dompet untuk tujuan baru). */
export async function completeGoalAction(
  ruang: unknown,
  input: z.input<typeof goalIdSchema>,
): Promise<ActionResult<{ goalId: string; status: GoalStatus }>> {
  return mutate('completeGoalAction', actionContext(ruang), async (ctx) =>
    completeGoal(ledger(ctx), parseInput(goalIdSchema, input)),
  );
}

/** Arsipkan tujuan (aktif atau selesai); bisa dipulihkan. */
export async function archiveGoalAction(
  ruang: unknown,
  input: z.input<typeof goalIdSchema>,
): Promise<ActionResult<{ goalId: string; status: GoalStatus }>> {
  return mutate('archiveGoalAction', actionContext(ruang), async (ctx) =>
    archiveGoal(ledger(ctx), parseInput(goalIdSchema, input)),
  );
}

/** Pulihkan tujuan selesai/arsip; juga `Urungkan` sesudah Selesaikan/Arsipkan. */
export async function restoreGoalAction(
  ruang: unknown,
  input: z.input<typeof goalIdSchema>,
): Promise<ActionResult<{ goalId: string; status: GoalStatus }>> {
  return mutate('restoreGoalAction', actionContext(ruang), async (ctx) =>
    restoreGoal(ledger(ctx), parseInput(goalIdSchema, input)),
  );
}
