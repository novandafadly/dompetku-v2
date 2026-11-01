import pg from 'pg';

/**
 * Dua pool `pg` sebagai dompetku_web (BSD §4, §5):
 * - pool auth: `search_path=auth`, hanya untuk Better Auth dan tabel auth sendiri;
 * - pool domain: tanpa search_path khusus, query selalu berskema, konteks user lewat `withUser`.
 * Parser tipe mengikuti TRD §3.6: date = string, int8 = number aman, numeric = string.
 */

const DATE_OID = 1082;
const INT8_OID = 20;

function parseInt8(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('int8 di luar rentang aman');
  return n;
}

const types = new pg.TypeOverrides();
types.setTypeParser(DATE_OID, (v: string) => v);
types.setTypeParser(INT8_OID, parseInt8);

export interface Pools {
  auth: pg.Pool;
  app: pg.Pool;
}

export function createPools(databaseUrl: string): Pools {
  const base = { connectionString: databaseUrl, max: 5, idleTimeoutMillis: 30_000, types };
  return {
    auth: new pg.Pool({ ...base, options: '-c search_path=auth' }),
    app: new pg.Pool(base),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, what: string): void {
  if (!UUID.test(value)) throw new Error(`${what} bukan uuid`);
}

/**
 * Satu transaksi dengan `app.user_id` lokal transaksi (BSD §4: `set_config(..., true)`,
 * koneksi kembali ke pool tanpa konteks). `spaceId` diisi bila operasi dibatasi ke satu ruang:
 * `app.assert_member` menolak dengan DK404 bila user bukan anggota.
 * Fungsi undangan (`invitation_peek`, `decline_invitation`, `accept_invitation`) mengisi GUC lokal
 * transaksi; panggil masing-masing di `withUser`/`withAnon` sendiri (packages/db/README.md).
 */
export async function withUser<T>(
  pool: pg.Pool,
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
  spaceId?: string,
): Promise<T> {
  assertUuid(userId, 'userId');
  if (spaceId !== undefined) assertUuid(spaceId, 'spaceId');
  return transaction(pool, async (client) => {
    await client.query("select pg_catalog.set_config('app.user_id', $1, true)", [userId]);
    if (spaceId !== undefined) await client.query('select app.assert_member($1)', [spaceId]);
    return fn(client);
  });
}

/** Transaksi tanpa user (pra-login: intip/tolak undangan, baca owner_email). */
export async function withAnon<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return transaction(pool, fn);
}

async function transaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    // Isolasi = bawaan role (READ COMMITTED, BSD §3); fungsi tulis memeriksanya sendiri.
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Galat domain dari fungsi SQL: SQLSTATE `DKnnn` + pesan pendek (BSD §9.2). */
export interface DomainError {
  code: string;
  message: string;
}

export function domainError(e: unknown): DomainError | null {
  if (typeof e !== 'object' || e === null) return null;
  const { code, message } = e as { code?: unknown; message?: unknown };
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  if (/^DK\d{3}$/.test(code) || code === '23505') return { code, message };
  return null;
}
