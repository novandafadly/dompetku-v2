'use server';

import type { z } from 'zod';
import type { ActionResult } from '@/features/ledger/types';
import {
  createAsset,
  createAssetSchema,
  revalueAsset,
  revalueAssetSchema,
  type CreateAssetValue,
  type RevalueAssetValue,
} from '@/server/ledger/aset';
import { actionContext, ledger, mutate, parseInput } from './context';

/**
 * Server Action Aset (S14; endpoint publik, pola di `context.ts`). Aset non-saham di kedua ruang
 * (K2), saham hanya Pribadi (DB: `pocket_personal_only`). Galat = kode tanpa nominal/nama
 * (`asset_negative`, `before_latest_entry`, …); salinan dipilih UI (`features/aset/galat.ts`).
 * Isi/cairkan aset = `createTransferAction` yang ada (sheet Transfer), bukan di sini.
 */

/** Aset baru; `clientId` stabil per pembukaan sheet (klik ganda/Coba lagi = replay). */
export async function createAssetAction(
  ruang: unknown,
  input: z.input<typeof createAssetSchema>,
): Promise<ActionResult<CreateAssetValue>> {
  return mutate('createAssetAction', actionContext(ruang), async (ctx) =>
    createAsset(ledger(ctx), parseInput(createAssetSchema, input)),
  );
}

/** Perbarui nilai: nilai sekarang → entri `valuation` sebesar selisih (0 = tidak ada entri). */
export async function revalueAssetAction(
  ruang: unknown,
  input: z.input<typeof revalueAssetSchema>,
): Promise<ActionResult<RevalueAssetValue>> {
  return mutate('revalueAssetAction', actionContext(ruang), async (ctx) =>
    revalueAsset(ledger(ctx), parseInput(revalueAssetSchema, input)),
  );
}
