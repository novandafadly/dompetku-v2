'use server';

import type { z } from 'zod';
import type {
  AccountVM,
  ActionResult,
  CategoryVM,
  EntryVM,
  HistoryVM,
} from '@/features/ledger/types';
import { getEntry, loadRuangShell } from '@/server/ledger/read';
import {
  moveEntryToSpace,
  NotInSpaceError,
  restoreEntry,
  restoreEntrySchema,
  updateEntry,
  updateEntrySchema,
  voidEntry,
  voidEntrySchema,
} from '@/server/ledger/write';
import { actionContext, ledger, mutate, parseInput, query, targetSpace } from './context';
import { entryIdInput, moveEntryInput, moveTargetsInput, type MoveEntryInput } from './inputs';

/**
 * Server Action Detail transaksi (endpoint publik; pola di `context.ts`). Entri yang disebut lewat
 * id wajib berada di ruang argumen (`NotInSpaceError` di wrapper = `not_found`).
 */

/** Ganti-penuh dengan `expectedVersion`; versi usang = `conflict` (lalu `reloadEntry`). */
export async function updateEntryAction(
  ruang: unknown,
  input: z.input<typeof updateEntrySchema>,
): Promise<ActionResult<{ entryId: string; version: number }>> {
  return mutate('updateEntryAction', actionContext(ruang), async (ctx) =>
    updateEntry(ledger(ctx), parseInput(updateEntrySchema, input)),
  );
}

/**
 * Batalkan entri (masuk Sampah 90 hari); juga dipakai "Urungkan" sesudah simpan. Transfer antar
 * ruang: id kaki di ruang argumen, DB membatalkan pasangannya (hanya pencatat: `not_creator`).
 */
export async function voidEntryAction(
  ruang: unknown,
  input: z.input<typeof voidEntrySchema>,
): Promise<ActionResult<{ version: number }>> {
  return mutate('voidEntryAction', actionContext(ruang), async (ctx) =>
    voidEntry(ledger(ctx), parseInput(voidEntrySchema, input)),
  );
}

/**
 * Pulihkan dari Sampah atau dari banner entri batal; lewat 90 hari = `restore_window_closed`.
 * Transfer antar ruang dipulihkan berpasangan (hanya pencatat); entri yang sudah dipindah ke ruang
 * lain = `entry_moved`.
 */
export async function restoreEntryAction(
  ruang: unknown,
  input: z.input<typeof restoreEntrySchema>,
): Promise<ActionResult<{ version: number }>> {
  return mutate('restoreEntryAction', actionContext(ruang), async (ctx) =>
    restoreEntry(ledger(ctx), parseInput(restoreEntrySchema, input)),
  );
}

export interface ReloadedEntry {
  entry: EntryVM;
  history: HistoryVM[];
}

/** Nilai terbaru untuk layar konflik; entri tidak ada di ruang ini = `not_found`. */
export async function reloadEntry(
  ruang: unknown,
  entryId: string,
): Promise<ActionResult<ReloadedEntry>> {
  return query('reloadEntry', actionContext(ruang), async (ctx) => {
    const v = parseInput(entryIdInput, { entryId });
    const found = await getEntry(ledger(ctx), v.entryId);
    // Tidak ada di ruang ini (atau bukan uuid ruang ini) = DK404 → `not_found`.
    if (!found) throw new NotInSpaceError();
    return found;
  });
}

/**
 * Hasil "Pindahkan ke ruang lain". Id entri baru hanya dikembalikan bila tujuannya Bersama
 * (dipanggil dari rute Pribadi). Dari rute Bersama tujuannya Pribadi, dan id entri Pribadi tidak
 * dikirim ke rute Bersama (Global Constraint S7): UI menuju daftar Transaksi Pribadi.
 */
export type MoveEntryValue =
  | { toRuang: 'bersama'; entryId: string; replayed: boolean }
  | { toRuang: 'pribadi'; replayed: boolean };

/**
 * Pindahkan pengeluaran/pemasukan ke ruang lain (hanya pencatat: `not_creator`). Ruang tujuan =
 * slug, di-resolve server. Ke Bersama, keterangan ikut hanya bila `keepDescription` (bawaan
 * tidak); ke Pribadi selalu ikut (DB).
 */
export async function moveEntryAction(
  ruang: unknown,
  input: MoveEntryInput,
): Promise<ActionResult<MoveEntryValue>> {
  return mutate('moveEntryAction', actionContext(ruang), async (ctx) => {
    const v = parseInput(moveEntryInput, input);
    const r = await moveEntryToSpace(ledger(ctx), {
      clientId: v.clientId,
      entryId: v.entryId,
      expectedVersion: v.expectedVersion,
      toSpaceId: await targetSpace(ctx, v.toRuang),
      accountId: v.accountId,
      categoryId: v.categoryId,
      keepDescription: v.keepDescription,
      allowNegative: v.allowNegative,
    });
    return v.toRuang === 'bersama'
      ? { toRuang: 'bersama', entryId: r.entryId, replayed: r.replayed }
      : { toRuang: 'pribadi', replayed: r.replayed };
  });
}

export interface MoveTargets {
  accounts: AccountVM[];
  categories: CategoryVM[];
}

/**
 * Pilihan sheet Pindahkan (dan tujuan transfer antar ruang): dompet aktif bukan Kantor (Kantor
 * tidak pernah ikut antar ruang: `cross_space_kantor`) dan kategori aktif ruang tujuan, dalam satu
 * transaksi baca. Data ruang tujuan milik pemanggil sendiri (anggota; Pribadi = miliknya).
 */
export async function moveTargetsAction(
  ruang: unknown,
  toRuang: unknown,
): Promise<ActionResult<MoveTargets>> {
  return query('moveTargetsAction', actionContext(ruang), async (ctx) => {
    const v = parseInput(moveTargetsInput, { toRuang });
    const spaceId = await targetSpace(ctx, v.toRuang);
    const shell = await loadRuangShell({ pools: ctx.pools, userId: ctx.userId, spaceId });
    return {
      accounts: shell.accounts.filter((a) => !a.archived && a.pocket !== 'kantor'),
      categories: shell.categories,
    };
  });
}
