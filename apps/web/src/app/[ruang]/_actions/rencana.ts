'use server';

import type { z } from 'zod';
import type { ActionResult } from '@/features/ledger/types';
import {
  archiveBill,
  billIdSchema,
  copyBudgets,
  copyBudgetsSchema,
  createBill,
  createBillSchema,
  deleteBudget,
  deleteBudgetSchema,
  occurrenceIdSchema,
  payBill,
  payBillSchema,
  setBudget,
  setBudgetSchema,
  setOccurrenceSkipped,
  updateBill,
  updateBillSchema,
  type CopyBudgetsValue,
} from '@/server/ledger/rencana';
import { actionContext, ledger, mutate, parseInput } from './context';

/**
 * Server Action Rencana (S9: anggaran dan tagihan; endpoint publik, pola di `context.ts`).
 * `mutate` = `refresh()` sesudah sukses: RSC ruang (Beranda, Rencana, Laporan; semuanya no-store)
 * dimuat ulang tanpa cache data. Galat = kode (`obligation_double`, `already_posted`, …), tanpa
 * nominal; salinan dipilih UI (bingkai S9 "Salinan galat S9").
 */

/** Atur anggaran kategori induk untuk label periode `month` (`YYYY-MM`); upsert. */
export async function setBudgetAction(
  ruang: unknown,
  input: z.input<typeof setBudgetSchema>,
): Promise<ActionResult<void>> {
  return mutate('setBudgetAction', actionContext(ruang), async (ctx) =>
    setBudget(ledger(ctx), parseInput(setBudgetSchema, input)),
  );
}

/** Hapus anggaran (tanpa baris = sukses). */
export async function deleteBudgetAction(
  ruang: unknown,
  input: z.input<typeof deleteBudgetSchema>,
): Promise<ActionResult<void>> {
  return mutate('deleteBudgetAction', actionContext(ruang), async (ctx) =>
    deleteBudget(ledger(ctx), parseInput(deleteBudgetSchema, input)),
  );
}

/** K13: salin anggaran periode sebelum `toMonth` ke `toMonth`; tidak menimpa, idempoten. */
export async function copyBudgetsAction(
  ruang: unknown,
  input: z.input<typeof copyBudgetsSchema>,
): Promise<ActionResult<CopyBudgetsValue>> {
  return mutate('copyBudgetsAction', actionContext(ruang), async (ctx) =>
    copyBudgets(ledger(ctx), parseInput(copyBudgetsSchema, input)),
  );
}

/** Tagihan baru (`clientId` dari klien: "Coba lagi" = replay, bukan tagihan kedua). */
export async function createBillAction(
  ruang: unknown,
  input: z.input<typeof createBillSchema>,
): Promise<ActionResult<{ billId: string }>> {
  return mutate('createBillAction', actionContext(ruang), async (ctx) =>
    createBill(ledger(ctx), parseInput(createBillSchema, input)),
  );
}

/** Ubah tagihan (ganti penuh; berlaku untuk kemunculan terbuka mulai hari ini). */
export async function updateBillAction(
  ruang: unknown,
  input: z.input<typeof updateBillSchema>,
): Promise<ActionResult<{ billId: string }>> {
  return mutate('updateBillAction', actionContext(ruang), async (ctx) =>
    updateBill(ledger(ctx), parseInput(updateBillSchema, input)),
  );
}

/** Arsip tagihan (idempoten alami). */
export async function archiveBillAction(
  ruang: unknown,
  billId: unknown,
): Promise<ActionResult<{ billId: string }>> {
  return mutate('archiveBillAction', actionContext(ruang), async (ctx) =>
    archiveBill(ledger(ctx), parseInput(billIdSchema, { billId }).billId),
  );
}

export interface PayBillValue {
  entryId: string;
  occurrenceId: string;
  version: number;
  replayed: boolean;
  warnings: string[];
}

/** Bayar kemunculan (`clientId` stabil per sheet: klik ganda = satu entri, C6). */
export async function payBillAction(
  ruang: unknown,
  input: z.input<typeof payBillSchema>,
): Promise<ActionResult<PayBillValue>> {
  return mutate('payBillAction', actionContext(ruang), async (ctx) =>
    payBill(ledger(ctx), parseInput(payBillSchema, input)),
  );
}

/** K4: `Lewati bulan ini` (sudah dibayar di luar alur Bayar). */
export async function skipBillAction(
  ruang: unknown,
  occurrenceId: unknown,
): Promise<ActionResult<{ skipped: boolean }>> {
  return mutate('skipBillAction', actionContext(ruang), async (ctx) =>
    setOccurrenceSkipped(
      ledger(ctx),
      parseInput(occurrenceIdSchema, { occurrenceId }).occurrenceId,
      true,
    ),
  );
}

/** K4: `Batalkan lewati`. */
export async function unskipBillAction(
  ruang: unknown,
  occurrenceId: unknown,
): Promise<ActionResult<{ skipped: boolean }>> {
  return mutate('unskipBillAction', actionContext(ruang), async (ctx) =>
    setOccurrenceSkipped(
      ledger(ctx),
      parseInput(occurrenceIdSchema, { occurrenceId }).occurrenceId,
      false,
    ),
  );
}
