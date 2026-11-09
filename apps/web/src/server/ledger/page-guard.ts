import 'server-only';
import { notFound, unstable_rethrow } from 'next/navigation';
import { isSpaceNotFoundError } from './errors';

/**
 * Dipakai di awal blok `catch` loader page `[ruang]`: sinyal Next (redirect, notFound) dilempar
 * ulang, dan hilangnya keanggotaan ruang di tengah request (`isSpaceNotFoundError`) menjadi 404,
 * bukan layar `*Failed` (HTTP 200). Galat lain dikembalikan ke pemanggil untuk dicatat dan
 * ditampilkan sebagai layar gagal muat.
 */
export function rethrowOrNotFound(e: unknown): void {
  unstable_rethrow(e);
  if (isSpaceNotFoundError(e)) notFound();
}
