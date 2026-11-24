'use server';

import { z } from 'zod';
import type { ActionResult } from '@/features/ledger/types';
import { parseFreeTextEntry, type ParseEntryResult } from '@/server/ai/parse-entry';
import { MAX_FREE_TEXT_LENGTH } from '@/server/ai/provider';
import { actionContext, ledger, parseInput, query } from './context';

const parseFreeTextSchema = z.object({
  text: z.string().trim().min(1).max(MAX_FREE_TEXT_LENGTH),
});

/**
 * Baca-saja (S17): mengurai teks bebas menjadi pratinjau isian Catat.
 * Tidak pernah menulis `app.entries` dan tidak pernah memanggil `refresh()`.
 * Pengguna wajib meninjau hasil di `CatatSheet` lalu menekan `Simpan` biasa.
 */
export async function parseFreeTextAction(
  ruang: unknown,
  input: { text: string },
): Promise<ActionResult<ParseEntryResult>> {
  return query('parseFreeTextAction', actionContext(ruang), async (ctx) => {
    const parsed = parseInput(parseFreeTextSchema, input);
    return parseFreeTextEntry(ledger(ctx), parsed.text);
  });
}
