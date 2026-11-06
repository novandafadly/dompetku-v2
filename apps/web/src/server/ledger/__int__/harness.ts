import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { OWNER, PARTNER, wipe } from '../../auth/__int__/harness';
import { createPools, withUser, type Pools } from '../../db';

/**
 * Harness tes integrasi ledger (pola `server/auth/__int__/harness.ts`): pool `dompetku_web`
 * sungguhan (`createPools`), pool superuser hanya untuk reset dan membaca id pembanding.
 * Persona dibuat lewat jalan produksi: insert `auth."user"` sebagai `dompetku_web` (trigger
 * `user_admission` berlaku, sama seperti Better Auth), kode pemulihan, lalu `api.bootstrap_owner`,
 * `api.create_invitation`, `api.accept_invitation`, `api.revoke_invitation` di dalam `withUser`.
 * Tidak ada insert mentah ke tabel `app.*`.
 */

export const LUAR = 'luar@example.test';

function url(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} wajib diisi untuk tes integrasi (lihat packages/db/README.md)`);
  return v;
}

export interface LedgerHarness {
  pools: Pools;
  admin: pg.Pool;
  close(): Promise<void>;
}

export function createLedgerHarness(): LedgerHarness {
  const pools = createPools(url('TEST_DATABASE_URL'));
  const admin = new pg.Pool({ connectionString: url('TEST_DATABASE_ADMIN_URL'), max: 2 });
  return {
    pools,
    admin,
    async close() {
      await Promise.all([pools.auth.end(), pools.app.end(), admin.end()]);
    },
  };
}

export interface Persona {
  id: string;
  email: string;
  name: string;
}

/** N = Novanda (pemilik), F = Farida (pasangan), Luar = akun terdaftar tanpa keanggotaan ruang. */
export interface Personas {
  n: Persona;
  f: Persona | null;
  luar: Persona | null;
}

/**
 * - `bergabung`: F diundang, mendaftar, dan menerima undangan (anggota Bersama, punya Pribadi).
 * - `diundang`: F mendaftar lewat undangan tetapi belum menerima (belum anggota ruang mana pun).
 * - `tidak_ada`: F belum ada.
 */
export type FaridaState = 'bergabung' | 'diundang' | 'tidak_ada';

export interface SeedOptions {
  farida?: FaridaState;
  /** Akun Luar: mendaftar dengan undangan yang lalu dicabut, jadi tidak pernah jadi anggota. */
  luar?: boolean;
}

/** Kosongkan semua data (superuser) dan pasang owner_email. */
export async function resetLedger(h: LedgerHarness): Promise<void> {
  await wipe(h.admin);
}

/** Daftarkan akun seperti Better Auth (role web, trigger pendaftaran berlaku) lalu "amankan". */
async function signUp(h: LedgerHarness, email: string, name: string): Promise<Persona> {
  const id = randomUUID();
  await h.pools.auth.query(
    'insert into "user" (id, name, email, "emailVerified") values ($1, $2, $3, true)',
    [id, name, email],
  );
  await h.pools.auth.query('insert into recovery_codes (user_id, code_hash) values ($1, $2)', [
    id,
    `$argon2id$v=19$tes-${randomBytes(6).toString('hex')}`,
  ]);
  return { id, email, name };
}

function tokenHash(): Buffer {
  return createHash('sha256').update(randomBytes(32)).digest();
}

async function invite(h: LedgerHarness, owner: Persona, email: string, hash: Buffer) {
  return withUser(h.pools.app, owner.id, async (c) => {
    const { rows } = await c.query<{ r: { invitation_id: string } }>(
      'select api.create_invitation(p_email => $1, p_token_hash => $2) as r',
      [email, hash],
    );
    const id = rows[0]?.r.invitation_id;
    if (!id) throw new Error('undangan tidak terbuat');
    return id;
  });
}

export async function seedPersonas(
  h: LedgerHarness,
  { farida = 'bergabung', luar = false }: SeedOptions = {},
): Promise<Personas> {
  const n = await signUp(h, OWNER, 'Novanda');
  await withUser(h.pools.app, n.id, (c) =>
    c.query('select api.bootstrap_owner(p_display_name => $1)', [n.name]),
  );

  let luarPersona: Persona | null = null;
  if (luar) {
    const invitationId = await invite(h, n, LUAR, tokenHash());
    luarPersona = await signUp(h, LUAR, 'Luar');
    await withUser(h.pools.app, n.id, (c) =>
      c.query('select api.revoke_invitation(p_invitation_id => $1)', [invitationId]),
    );
  }

  let f: Persona | null = null;
  if (farida !== 'tidak_ada') {
    const hash = tokenHash();
    await invite(h, n, PARTNER, hash);
    f = await signUp(h, PARTNER, 'Farida');
    if (farida === 'bergabung') {
      const uid = f.id;
      // accept_invitation mengisi GUC lokal transaksi: transaksi sendiri (packages/db/README.md).
      await withUser(h.pools.app, uid, (c) =>
        c.query('select api.accept_invitation(p_token_hash => $1, p_display_name => $2)', [
          hash,
          'Farida',
        ]),
      );
    }
  }

  return { n, f, luar: luarPersona };
}

/** Id ruang pembanding, dibaca sebagai superuser (seperti `tests.space_id` di pgTAP). */
export async function spaceIdOf(
  h: LedgerHarness,
  userId: string,
  kind: 'personal' | 'shared',
): Promise<string> {
  const { rows } = await h.admin.query<{ id: string }>(
    `select s.id from app.spaces s
      where s.kind = $1 and (s.kind = 'shared' or s.owner_user_id = $2)`,
    [kind, userId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`ruang ${kind} tidak ada`);
  return id;
}

/**
 * true bila nominal `n` muncul sebagai nilai di `value` (angka, string digit, atau teks berformat
 * `6.500`). Pengganti `JSON.stringify(x).not.toContain('6500')`, yang gagal palsu saat UUID atau
 * stempel waktu acak kebetulan memuat digit yang sama.
 */
export function memuatNominal(value: unknown, n: number): boolean {
  const target = Math.abs(n);
  const formatted = target.toLocaleString('id-ID');
  const visit = (v: unknown): boolean => {
    if (typeof v === 'number' || typeof v === 'bigint') return Math.abs(Number(v)) === target;
    if (typeof v === 'string') {
      if (/^-?\d+$/.test(v)) return Math.abs(Number(v)) === target;
      return (
        target >= 1000 &&
        new RegExp(`(^|[^\\d.])${formatted.replace(/\./g, '\\.')}($|[^\\d.])`).test(v)
      );
    }
    if (Array.isArray(v)) return v.some(visit);
    if (v && typeof v === 'object') return Object.values(v).some(visit);
    return false;
  };
  return visit(value);
}
