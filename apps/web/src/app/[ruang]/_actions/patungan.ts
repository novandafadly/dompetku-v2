'use server';

import type { z } from 'zod';
import type { ActionResult } from '@/features/ledger/types';
import type {
  CreateSplitResultVM,
  PatunganWalletsVM,
  SettleResultVM,
} from '@/features/patungan/types';
import {
  createSplit,
  createSplitSchema,
  loadPatunganWallets,
  receiveSettlement,
  receiveSettlementSchema,
  restoreSplit,
  settleSplit,
  settleSplitSchema,
  settlementActionSchema,
  splitActionSchema,
  SplitSharedOnlyError,
  voidReceipt,
  voidSettlement,
  voidSplit,
  type VoidSplitValue,
} from '@/server/ledger/patungan';
import type { LedgerCtx } from '@/server/ledger/write';
import { actionContext, ledger, mutate, parseInput, query, type ActionCtx } from './context';

/**
 * Server Action Patungan / bagi tagihan Bersama (S12; endpoint publik, pola di `context.ts`).
 * Hanya Bersama: ruang Pribadi = `split_shared_only` sebelum menyentuh DB. Galat = kode tanpa
 * nominal/nama; salinan dipilih UI (`features/patungan/galat.ts`). Dompet Pribadi pembayar,
 * pelunas, dan penerima dipilih lewat id; DB menolak dompet yang tidak terlihat/bukan miliknya
 * (`account_not_found`, `split_account_invalid`) tanpa membocorkan apa pun.
 */

function bersama(ctx: ActionCtx): LedgerCtx {
  if (ctx.kind !== 'shared') throw new SplitSharedOnlyError();
  return ledger(ctx);
}

/** Tagihan patungan baru (`clientId` dari klien: "Coba lagi" = replay). */
export async function createSplitAction(
  ruang: unknown,
  input: z.input<typeof createSplitSchema>,
): Promise<ActionResult<CreateSplitResultVM>> {
  return mutate('createSplitAction', actionContext(ruang), async (ctx) =>
    createSplit(bersama(ctx), parseInput(createSplitSchema, input)),
  );
}

/** Hapus tagihan patungan (hanya pembayar); juga `Urungkan` sesudah mencatat. */
export async function voidSplitAction(
  ruang: unknown,
  input: z.input<typeof splitActionSchema>,
): Promise<ActionResult<VoidSplitValue>> {
  return mutate('voidSplitAction', actionContext(ruang), async (ctx) =>
    voidSplit(bersama(ctx), parseInput(splitActionSchema, input)),
  );
}

/** Pulihkan tagihan yang dihapus (≤ 90 hari). */
export async function restoreSplitAction(
  ruang: unknown,
  input: z.input<typeof splitActionSchema>,
): Promise<ActionResult<VoidSplitValue>> {
  return mutate('restoreSplitAction', actionContext(ruang), async (ctx) =>
    restoreSplit(bersama(ctx), parseInput(splitActionSchema, input)),
  );
}

/** Lunasi patungan dari dompet Pribadi pelunas (`clientId` stabil per sheet: klik ganda = satu pelunasan). */
export async function settleSplitAction(
  ruang: unknown,
  input: z.input<typeof settleSplitSchema>,
): Promise<ActionResult<SettleResultVM>> {
  return mutate('settleSplitAction', actionContext(ruang), async (ctx) =>
    settleSplit(bersama(ctx), parseInput(settleSplitSchema, input)),
  );
}

/** Batalkan pelunasan (hanya pelunas; ditolak bila sudah diterima); juga `Urungkan`. */
export async function voidSettlementAction(
  ruang: unknown,
  input: z.input<typeof settlementActionSchema>,
): Promise<ActionResult<VoidSplitValue>> {
  return mutate('voidSettlementAction', actionContext(ruang), async (ctx) =>
    voidSettlement(bersama(ctx), parseInput(settlementActionSchema, input)),
  );
}

/** Terima pelunasan ke dompet Pribadi penerima. */
export async function receiveSettlementAction(
  ruang: unknown,
  input: z.input<typeof receiveSettlementSchema>,
): Promise<ActionResult<{ settlementId: string; amount: number; replayed: boolean }>> {
  return mutate('receiveSettlementAction', actionContext(ruang), async (ctx) =>
    receiveSettlement(bersama(ctx), parseInput(receiveSettlementSchema, input)),
  );
}

/** Batalkan penerimaan (hanya penerima); juga `Urungkan` sesudah menerima. */
export async function voidReceiptAction(
  ruang: unknown,
  input: z.input<typeof settlementActionSchema>,
): Promise<ActionResult<VoidSplitValue>> {
  return mutate('voidReceiptAction', actionContext(ruang), async (ctx) =>
    voidReceipt(bersama(ctx), parseInput(settlementActionSchema, input)),
  );
}

/**
 * Dompet Pribadi penonton untuk sheet Lunasi/Terima dan dialog akibat, dimuat saat pertama dibuka
 * (R27: data Pribadi tidak lewat props rute Bersama).
 */
export async function patunganWalletsAction(
  ruang: unknown,
): Promise<ActionResult<PatunganWalletsVM>> {
  return query('patunganWalletsAction', actionContext(ruang), async (ctx) =>
    loadPatunganWallets({ ...bersama(ctx), kind: ctx.kind }),
  );
}
