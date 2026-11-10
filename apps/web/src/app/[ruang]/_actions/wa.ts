'use server';

import type { ActionResult } from '@/features/ledger/types';
import { createWaLinkCode, unlinkWa as unlinkWaLink } from '@/server/wa/link';
import { accountContext, mutate, query } from './context';

/**
 * Server Action WhatsApp (endpoint publik; pola di `context.ts`). Tingkat akun: tanpa argumen,
 * user selalu dari sesi (`accountContext`). Kode hubung hanya ada di hasil action ini: tidak
 * disimpan dan tidak dilog (galat dilog tersamar oleh `query`, hanya nama galat atau SQLSTATE).
 * Fitur mati di server = `WaDisabledError` = `unknown`.
 */

/** Buat kode hubung 6 karakter (berlaku 10 menit); menimpa kode lama user ini. */
export async function createLinkCode(): Promise<ActionResult<{ code: string; expiresAt: string }>> {
  return query('createLinkCode', accountContext(), createWaLinkCode);
}

/** Putuskan nomor user ini (baris milik sendiri saja, lewat RLS); halaman dimuat ulang. */
export async function unlinkWa(): Promise<ActionResult<void>> {
  return mutate('unlinkWa', accountContext(), unlinkWaLink);
}
