import 'server-only';
import { refresh } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z, ZodError } from 'zod';
import type { ActionResult, LedgerErrorCode } from '@/features/ledger/types';
import { authService, requireDataUser } from '@/server/auth/next';
import type { Pools } from '@/server/db';
import { toLedgerError } from '@/server/ledger/errors';
import { resolveSpace } from '@/server/ledger/space';

/**
 * Pembantu Server Action ruang (bukan `'use server'`: tidak ada yang diekspor sebagai endpoint).
 * Server Action = endpoint publik (TRD §3.4, Aturan M1): `requireDataUser()` → Zod → `withUser`.
 *
 * Setiap action ditulis
 *   `return mutate('<nama>', actionContext(ruang), async (ctx) => { … })`
 * sehingga `actionContext` (gerbang sesi) dipanggil lebih dulu daripada apa pun (argumen dievaluasi
 * kiri ke kanan); `mutate`/`query`/`quietly` hanya meng-await-nya di dalam `try` untuk memetakan
 * galat. Tes `actions.test.ts` memindai sumber untuk bentuk ini.
 *
 * Galat ke klien:
 * - mode prototipe (`requireDataUser()` = null) dan redirect/notFound Next = DILEMPAR (satu-satunya);
 * - ZodError (input) = `{ code: 'invalid', field }`, field = jalur isu pertama digabung titik;
 * - galat domain/jaringan = `toLedgerError`;
 * - lainnya = `{ code: 'unknown' }`, dilog hanya nama action + SQLSTATE/errno atau nama galat
 *   (tanpa pesan, detail, atau parameter: bisa memuat nominal/deskripsi).
 */

/** Action dipanggil di mode prototipe: data demo hidup di klien, DB tidak pernah disentuh. */
export class PrototypeActionError extends Error {
  constructor() {
    super('prototipe');
    this.name = 'PrototypeActionError';
  }
}

export interface ActionCtx {
  pools: Pools;
  userId: string;
  spaceId: string;
  kind: 'personal' | 'shared';
}

/** Dibungkus objek agar ZodError membawa jalur `ruang` (field galat). */
const ruangInput = z.object({ ruang: z.enum(['pribadi', 'bersama']) });

/**
 * Gerbang setiap action: sesi penuh (`requireDataUser`, redirect bila belum masuk), ruang dari
 * argumen eksplisit (Zod), lalu `space_id` di-resolve di server (`resolveSpace`, konteks user).
 * `spaceId` kiriman klien tidak pernah dipakai.
 */
export async function actionContext(ruang: unknown): Promise<ActionCtx> {
  const state = await requireDataUser();
  if (state === null) throw new PrototypeActionError();
  const parsed = ruangInput.parse({ ruang });
  const pools = authService().pools;
  const { spaceId, kind } = await resolveSpace(pools, state.userId, parsed.ruang);
  return { pools, userId: state.userId, spaceId, kind };
}

/** Konteks untuk wrapper `server/ledger/*` (tanpa `kind`). */
export function ledger(ctx: ActionCtx): { pools: Pools; userId: string; spaceId: string } {
  return { pools: ctx.pools, userId: ctx.userId, spaceId: ctx.spaceId };
}

const SAFE_TAG = /^[A-Za-z0-9_]{1,64}$/;

/** SQLSTATE/errno atau nama galat, hanya bila berbentuk kode; selain itu `unknown`. */
function errorTag(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const { code, name } = e as { code?: unknown; name?: unknown };
    if (typeof code === 'string' && SAFE_TAG.test(code)) return code;
    if (typeof name === 'string' && SAFE_TAG.test(name)) return name;
  }
  return 'unknown';
}

const FIELD = /^[A-Za-z0-9_.]{1,128}$/;

function toActionError(name: string, e: unknown): { code: LedgerErrorCode; field?: string } {
  // Redirect sesi (requireUser), notFound, dan sinyal Next lain bukan galat action.
  unstable_rethrow(e);
  if (e instanceof PrototypeActionError) throw e;
  if (e instanceof ZodError) {
    const field = e.issues[0]?.path.map(String).join('.') ?? '';
    return FIELD.test(field) ? { code: 'invalid', field } : { code: 'invalid' };
  }
  const mapped = toLedgerError(e);
  if (mapped) return mapped;
  console.error('[ledger action]', name, errorTag(e));
  return { code: 'unknown' };
}

/** Baca: hasil `ActionResult`, tanpa refresh. */
export async function query<T>(
  name: string,
  ctx: Promise<ActionCtx>,
  fn: (ctx: ActionCtx) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await fn(await ctx) };
  } catch (e) {
    return { ok: false, error: toActionError(name, e) };
  }
}

/**
 * Tulis: seperti `query`, lalu `refresh()` (Next 16, hanya di Server Action) agar RSC ruang dimuat
 * ulang tanpa cache data. Di luar `try`: kegagalan refresh = salah pakai, bukan galat ledger, dan
 * tidak boleh membuat entri yang sudah tersimpan tampak gagal.
 */
export async function mutate<T>(
  name: string,
  ctx: Promise<ActionCtx>,
  fn: (ctx: ActionCtx) => Promise<T>,
): Promise<ActionResult<T>> {
  const result = await query(name, ctx, fn);
  if (result.ok) refresh();
  return result;
}

/**
 * Efek samping yang tidak boleh mengganggu alur (event produk): semua galat ditelan (dilog
 * tersamar) kecuali mode prototipe dan sinyal Next, yang tetap dilempar seperti action lain.
 */
export async function quietly(
  name: string,
  ctx: Promise<ActionCtx>,
  fn: (ctx: ActionCtx) => Promise<void>,
): Promise<void> {
  // Galat tak dikenal sudah dilog tersamar oleh `query`; hasilnya sengaja dibuang.
  await query(name, ctx, fn);
}

/** Jalankan efek samping sesudah aksi utama; galatnya ditelan (dilog tersamar). */
export async function swallow(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    unstable_rethrow(e);
    console.error('[ledger action]', name, errorTag(e));
  }
}
