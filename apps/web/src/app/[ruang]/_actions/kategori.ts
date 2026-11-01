'use server';

import type { z } from 'zod';
import type { ActionResult } from '@/features/ledger/types';
import {
  archiveCategory,
  archiveCategorySchema,
  createCategory,
  createCategorySchema,
  updateCategory,
  updateCategorySchema,
} from '@/server/ledger/write';
import { actionContext, ledger, mutate } from './context';

/** Server Action kelola kategori (endpoint publik; pola di `context.ts`). */

export async function createCategoryAction(
  ruang: unknown,
  input: z.input<typeof createCategorySchema>,
): Promise<ActionResult<{ categoryId: string }>> {
  return mutate('createCategoryAction', actionContext(ruang), async (ctx) =>
    createCategory(ledger(ctx), createCategorySchema.parse(input)),
  );
}

/** Ganti penuh nama, ikon, induk (idempoten secara alami). */
export async function updateCategoryAction(
  ruang: unknown,
  input: z.input<typeof updateCategorySchema>,
): Promise<ActionResult<void>> {
  return mutate('updateCategoryAction', actionContext(ruang), async (ctx) =>
    updateCategory(ledger(ctx), updateCategorySchema.parse(input)),
  );
}

/** Arsip kategori beserta anak aktifnya; `affected` = baris yang berubah. */
export async function archiveCategoryAction(
  ruang: unknown,
  input: z.input<typeof archiveCategorySchema>,
): Promise<ActionResult<{ affected: number }>> {
  return mutate('archiveCategoryAction', actionContext(ruang), async (ctx) =>
    archiveCategory(ledger(ctx), archiveCategorySchema.parse(input)),
  );
}
