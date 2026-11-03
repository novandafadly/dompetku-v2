import 'server-only';
import type { Ruang } from '@/features/ledger/types';
import { withUser, type Pools } from '../db';

/**
 * Ruang tidak ditemukan atau user bukan anggota (disamakan, seperti DK404 di DB).
 * Bentuknya meniru galat `app.assert_member` (`code = 'DK404'`, pesan `space_not_found`) sehingga
 * `toLedgerError` memetakannya ke `not_found` tanpa kasus khusus.
 * Page: `if (e instanceof SpaceNotFoundError) notFound();`. Action: `toLedgerError(e)` →
 * `{ ok: false, error: { code: 'not_found' } }`.
 */
export class SpaceNotFoundError extends Error {
  readonly code = 'DK404';
  constructor() {
    super('space_not_found');
    this.name = 'SpaceNotFoundError';
  }
}

const KIND: Record<Ruang, 'personal' | 'shared'> = { pribadi: 'personal', bersama: 'shared' };

export interface ResolvedSpace {
  spaceId: string;
  kind: 'personal' | 'shared';
}

/**
 * Ruang di URL (`pribadi`/`bersama`) → `space_id`, dibaca dengan konteks user (RLS
 * `member_read`: hanya ruang yang user anggotai). Pribadi dibatasi lagi ke milik user sendiri.
 * Melempar `SpaceNotFoundError` bila ruang tidak ada, user bukan anggota, atau `ruang` bukan
 * nilai yang dikenal (parameter URL mentah).
 */
export async function resolveSpace(
  pools: Pools,
  userId: string,
  ruang: Ruang,
): Promise<ResolvedSpace> {
  const kind = Object.hasOwn(KIND, ruang) ? KIND[ruang] : undefined;
  if (kind === undefined) throw new SpaceNotFoundError();
  const rows = await withUser(pools.app, userId, async (c) => {
    const r = await c.query<{ id: string }>(
      `select s.id from app.spaces s
        where s.kind = $1::app.space_kind
          and (s.kind = 'shared' or s.owner_user_id = app.current_user_id())`,
      [kind],
    );
    return r.rows;
  });
  const [row, extra] = rows;
  // Lebih dari satu baris melanggar indeks unik ruang; anggap tidak ditemukan daripada menebak.
  if (!row || extra) throw new SpaceNotFoundError();
  return { spaceId: row.id, kind };
}
