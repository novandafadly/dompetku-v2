import 'server-only';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import type { Ruang } from '@/features/ledger/types';
import { isRuang } from '@/features/shell/hrefs';
import { authService, requireDataUser } from '@/server/auth/next';
import { resolveSpace, SpaceNotFoundError } from '@/server/ledger/space';
import type { LedgerCtx } from '@/server/ledger/write';

/**
 * Konteks data page/layout `[ruang]` mode nyata (Aturan M1), urutannya tetap:
 * 1. `requireDataUser()` (sesi penuh; redirect bila tidak) sebelum apa pun,
 * 2. ruang dari URL divalidasi, lalu `resolveSpace` di server (bukan anggota = 404),
 * 3. baru loader, dengan `ctx` ini (`withUser` + `space_id` ruang ini saja).
 * `connection()`: dirender per request, tidak pernah dari cache (halaman berdata no-store).
 * Hanya untuk mode nyata: page memeriksa `isPrototype()` lebih dulu.
 */
export async function ruangContext(
  params: Promise<{ ruang: string }>,
): Promise<LedgerCtx & { ruang: Ruang; kind: 'personal' | 'shared' }> {
  const state = await requireDataUser();
  if (state === null) throw new Error('ruangContext dipanggil di mode prototipe');
  await connection();
  const { ruang } = await params;
  if (!isRuang(ruang)) notFound();
  const pools = authService().pools;
  try {
    const { spaceId, kind } = await resolveSpace(pools, state.userId, ruang);
    return { pools, userId: state.userId, spaceId, ruang, kind };
  } catch (e) {
    if (e instanceof SpaceNotFoundError) notFound();
    throw e;
  }
}
