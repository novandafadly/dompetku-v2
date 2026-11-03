'use server';

import type { AccountVM, ActionResult, CategoryVM } from '@/features/ledger/types';
import { recordProductEvent } from '@/server/ledger/events';
import { listAccounts, listCategories, suggestCategories } from '@/server/ledger/read';
import { createEntry, createTransfer } from '@/server/ledger/write';
import { actionContext, ledger, mutate, parseInput, query, quietly } from './context';
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

export interface SaveCatatValue {
  entryId: string;
  version: number;
  replayed: boolean;
}

/** Simpan pengeluaran, pemasukan, atau transfer di ruang ini. */
export async function saveCatat(
  ruang: unknown,
  input: SaveCatatInput,
): Promise<ActionResult<SaveCatatValue>> {
  return mutate('saveCatat', actionContext(ruang), async (ctx) => {
    const v = parseInput(saveCatatInput, input);
    if (v.kind === 'transfer') return createTransfer(ledger(ctx), v);
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
