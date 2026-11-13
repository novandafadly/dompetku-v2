'use server';

import type { z } from 'zod';
import type { ActionResult } from '@/features/ledger/types';
import type { DebtNumbersVM } from '@/features/utang/types';
import {
  archiveContact,
  contactIdSchema,
  createContact,
  createContactSchema,
  createDebt,
  createDebtSchema,
  debtActionSchema,
  DebtPersonalOnlyError,
  payDebt,
  payDebtSchema,
  renameContact,
  renameContactSchema,
  restoreDebt,
  updateDebtInfo,
  updateDebtInfoSchema,
  voidDebt,
  type ContactValue,
  type CreateDebtValue,
  type PayDebtValue,
  type VoidDebtValue,
} from '@/server/ledger/utang';
import type { LedgerCtx } from '@/server/ledger/write';
import { actionContext, ledger, mutate, parseInput, type ActionCtx } from './context';

/**
 * Server Action Utang dan Kontak (S11; endpoint publik, pola di `context.ts`). Hanya Pribadi:
 * ruang Bersama = `debt_personal_only` sebelum menyentuh DB (B10). Galat = kode tanpa nominal/nama;
 * salinan dipilih UI (`features/utang/galat.ts`). Batal/pulihkan satu cicilan memakai
 * `voidEntryAction`/`restoreEntryAction` biasa (`entri.ts`).
 */

function pribadi(ctx: ActionCtx): LedgerCtx {
  if (ctx.kind !== 'personal') throw new DebtPersonalOnlyError();
  return ledger(ctx);
}

/** Kontak baru (`clientId` dari klien: "Coba lagi" = replay). */
export async function createContactAction(
  ruang: unknown,
  input: z.input<typeof createContactSchema>,
): Promise<ActionResult<ContactValue & { replayed: boolean }>> {
  return mutate('createContactAction', actionContext(ruang), async (ctx) =>
    createContact(pribadi(ctx), parseInput(createContactSchema, input)),
  );
}

/** Ganti nama kontak (berlaku di semua utangnya; angka tidak berubah). */
export async function renameContactAction(
  ruang: unknown,
  input: z.input<typeof renameContactSchema>,
): Promise<ActionResult<ContactValue>> {
  return mutate('renameContactAction', actionContext(ruang), async (ctx) =>
    renameContact(pribadi(ctx), parseInput(renameContactSchema, input)),
  );
}

/** Arsip kontak (idempoten alami; utang lama tetap). */
export async function archiveContactAction(
  ruang: unknown,
  input: z.input<typeof contactIdSchema>,
): Promise<ActionResult<{ contactId: string }>> {
  return mutate('archiveContactAction', actionContext(ruang), async (ctx) =>
    archiveContact(pribadi(ctx), parseInput(contactIdSchema, input)),
  );
}

/** Utang/piutang baru; kontak baru (`contactName`) dibuat di transaksi yang sama. */
export async function createDebtAction(
  ruang: unknown,
  input: z.input<typeof createDebtSchema>,
): Promise<ActionResult<CreateDebtValue>> {
  return mutate('createDebtAction', actionContext(ruang), async (ctx) =>
    createDebt(pribadi(ctx), parseInput(createDebtSchema, input)),
  );
}

/** Ubah kontak/judul/catatan (ganti penuh, K4); tanpa efek ke saldo, cicilan, sisa. */
export async function updateDebtInfoAction(
  ruang: unknown,
  input: z.input<typeof updateDebtInfoSchema>,
): Promise<ActionResult<{ debtId: string }>> {
  return mutate('updateDebtInfoAction', actionContext(ruang), async (ctx) =>
    updateDebtInfo(pribadi(ctx), parseInput(updateDebtInfoSchema, input)),
  );
}

/** Bayar/terima cicilan (`clientId` stabil per sheet: klik ganda = satu entri, C6). */
export async function payDebtAction(
  ruang: unknown,
  input: z.input<typeof payDebtSchema>,
): Promise<ActionResult<PayDebtValue>> {
  return mutate('payDebtAction', actionContext(ruang), async (ctx) =>
    payDebt(pribadi(ctx), parseInput(payDebtSchema, input)),
  );
}

/** Hapus utang (K5): pokok + semua cicilan hidup dibatalkan atomik. */
export async function voidDebtAction(
  ruang: unknown,
  input: z.input<typeof debtActionSchema>,
): Promise<ActionResult<VoidDebtValue>> {
  return mutate('voidDebtAction', actionContext(ruang), async (ctx) =>
    voidDebt(pribadi(ctx), parseInput(debtActionSchema, input)),
  );
}

/** Pulihkan utang yang dihapus (≤ 90 hari); juga `Urungkan` sesudah Hapus. */
export async function restoreDebtAction(
  ruang: unknown,
  input: z.input<typeof debtActionSchema>,
): Promise<ActionResult<VoidDebtValue & DebtNumbersVM>> {
  return mutate('restoreDebtAction', actionContext(ruang), async (ctx) =>
    restoreDebt(pribadi(ctx), parseInput(debtActionSchema, input)),
  );
}
