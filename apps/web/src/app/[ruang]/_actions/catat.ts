'use server';

import type { AccountVM, ActionResult, CategoryVM } from '@/features/ledger/types';
import { recordProductEvent } from '@/server/ledger/events';
import { listAccounts, listCategories, suggestCategories } from '@/server/ledger/read';
import { createEntry, createSpaceTransfer, createTransfer } from '@/server/ledger/write';
import {
  ActionInputError,
  actionContext,
  ledger,
  mutate,
  parseInput,
  query,
  quietly,
  targetSpace,
} from './context';
import {
  catatEventInput,
  saveCatatInput,
  suggestForInput,
  type CatatEventInput,
  type SaveCatatInput,
  type SuggestForInput,
} from './inputs';

/**
 * Server Action sheet Catat (endpoint publik; pola di `context.ts`). Ruang selalu eksplisit dan
 * di-resolve di server; `clientId` dari klien menjadi kunci idempotensi (`replayed: true` saat
 * "Coba lagi" dengan `clientId` yang sama).
 */

/**
 * `entryId` = entri di ruang argumen saja. Transfer antar ruang: kaki sumber (ruang argumen);
 * id kaki ruang lain (`linkedEntryId`) dan `linkId` tidak pernah dikembalikan, sehingga rute
 * Bersama tidak menerima id entri Pribadi (Global Constraint S7). "Urungkan" membatalkan kaki
 * sumber; DB membatalkan pasangannya.
 */
export interface SaveCatatValue {
  entryId: string;
  version: number;
  replayed: boolean;
}

/**
 * Simpan pengeluaran, pemasukan (talangan: `reimbursable`, pengeluaran Pribadi saja), transfer
 * di ruang ini, atau transfer antar ruang (`space_transfer`, ruang tujuan `toRuang`).
 */
export async function saveCatat(
  ruang: unknown,
  input: SaveCatatInput,
): Promise<ActionResult<SaveCatatValue>> {
  return mutate('saveCatat', actionContext(ruang), async (ctx) => {
    const v = parseInput(saveCatatInput, input);
    if (v.kind === 'transfer') return createTransfer(ledger(ctx), v);
    if (v.kind === 'space_transfer') {
      const toSpaceId = await targetSpace(ctx, v.toRuang);
      const r = await createSpaceTransfer(ledger(ctx), {
        clientId: v.clientId,
        fromAccountId: v.fromAccountId,
        toSpaceId,
        toAccountId: v.toAccountId,
        amount: v.amount,
        fee: v.fee ?? 0,
        occurredOn: v.occurredOn,
        description: v.description,
        sharedNote: v.sharedNote,
        allowNegative: v.allowNegative ?? false,
      });
      return { entryId: r.entryId, version: r.version, replayed: r.replayed };
    }
    // Talangan hanya pengeluaran Pribadi (DB `reimbursable_personal_expense_only`): ditolak
    // sebagai galat input sebelum DB, bukan DK422 tak terpetakan.
    if (v.reimbursable === true && (v.kind !== 'expense' || ctx.kind !== 'personal')) {
      throw new ActionInputError('reimbursable');
    }
    const r = await createEntry(ledger(ctx), v);
    return { entryId: r.entryId, version: r.version, replayed: r.replayed };
  });
}

export interface CatatOptions {
  accounts: AccountVM[];
  categories: CategoryVM[];
}

/** Dompet dan kategori aktif ruang tujuan saat pindah ruang di sheet (data ruang itu saja). */
export async function catatOptions(ruang: unknown): Promise<ActionResult<CatatOptions>> {
  return query('catatOptions', actionContext(ruang), async (ctx) => {
    const [accounts, categories] = await Promise.all([
      listAccounts(ledger(ctx)),
      listCategories(ledger(ctx)),
    ]);
    return { accounts, categories };
  });
}

/** Id kategori saran (6 teratas, urutan `api.suggest_categories`). */
export async function suggestFor(
  ruang: unknown,
  i: SuggestForInput,
): Promise<ActionResult<string[]>> {
  return query('suggestFor', actionContext(ruang), async (ctx) =>
    suggestCategories(ledger(ctx), parseInput(suggestForInput, i)),
  );
}

/** Event produk Catat; galat apa pun ditelan (kecuali mode prototipe/redirect sesi). */
export async function logCatatEvent(ruang: unknown, e: CatatEventInput): Promise<void> {
  return quietly('logCatatEvent', actionContext(ruang), async (ctx) => {
    const v = parseInput(catatEventInput, e);
    await recordProductEvent(ctx.pools, ctx.userId, { ...v, spaceKind: ctx.kind });
  });
}
