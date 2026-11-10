import { createHmac } from 'node:crypto';
import pg from 'pg';
import { createPools, type Pools } from '../../db';
import type { ServerEnv } from '../../env';
import { LogMailer, type Mailer } from '../mailer';
import { AuthService, type SetCookie } from '../service';

export const OWNER = 'novanda@example.test';
export const PARTNER = 'farida@example.test';
export const PASSWORD = 'kuda-lari-di-sawah-42';

function url(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} wajib diisi untuk tes integrasi (lihat packages/db/README.md)`);
  return v;
}

export interface Harness {
  service: AuthService;
  mailer: LogMailer;
  admin: pg.Pool;
  pools: Pools;
  close(): Promise<void>;
}

export function createHarness(extraMailer?: Mailer, overrides: Partial<ServerEnv> = {}): Harness {
  const env: ServerEnv = {
    databaseUrl: url('TEST_DATABASE_URL'),
    authSecret: 'tes-integrasi-bukan-rahasia-0123456789abcdef',
    baseURL: 'http://localhost:3000',
    rpID: 'localhost',
    secureCookies: true,
    resendApiKey: null,
    emailFrom: 'DompetKu <tes@example.test>',
    checkPwnedPasswords: false,
    emailFile: null,
    ...overrides,
  };
  const pools = createPools(env.databaseUrl);
  const mailer = new LogMailer();
  // Mailer tambahan (mis. lambat) menerima email yang sama; LogMailer tetap mencatatnya.
  const sender: Mailer = extraMailer
    ? { send: (m) => Promise.all([mailer.send(m), extraMailer.send(m)]).then(() => undefined) }
    : mailer;
  const admin = new pg.Pool({ connectionString: url('TEST_DATABASE_ADMIN_URL'), max: 2 });
  return {
    service: new AuthService(env, pools, sender),
    mailer,
    admin,
    pools,
    async close() {
      await Promise.all([pools.auth.end(), pools.app.end(), admin.end()]);
    },
  };
}

/** Kosongkan data (superuser), lalu pasang owner_email seperti runbook. */
export async function reset(h: Harness): Promise<void> {
  h.mailer.sent.length = 0;
  await wipe(h.admin);
}

/** Hapus semua data domain dan auth (superuser), lalu pasang owner_email. Dipakai ulang harness ledger. */
export async function wipe(admin: pg.Pool): Promise<void> {
  await admin.query(`
    begin;
    select set_config('dompetku.purge', 'on', true);
    delete from app.product_events;
    delete from app.wa_messages;
    delete from app.wa_link_codes;
    delete from app.wa_links;
    delete from app.idempotency_keys;
    delete from app.invitations;
    delete from app.entry_lines;
    delete from app.entry_history;
    delete from app.entries;
    delete from app.entry_tombstones;
    delete from app.bill_occurrences;
    delete from app.bills;
    delete from app.budgets;
    delete from app.accounts;
    delete from app.categories;
    delete from app.no_spend_days;
    delete from app.space_members;
    delete from app.profiles;
    delete from app.spaces;
    delete from app.households;
    delete from audit.events;
    delete from auth."user";
    delete from auth.login_throttle;
    delete from auth.verification;
    insert into app.settings (key, value) values ('owner_email', '${OWNER}')
      on conflict (key) do update set value = excluded.value;
    commit;`);
}

/** Satu "peramban": menyimpan cookie dari Set-Cookie dan mengirimnya kembali. */
export class Browser {
  private jar = new Map<string, string>();
  constructor(private readonly ip = '203.0.113.7') {}

  headers(): Headers {
    const h = new Headers({ 'x-forwarded-for': this.ip, 'user-agent': 'vitest' });
    if (this.jar.size > 0) h.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    return h;
  }

  absorb(setCookie: SetCookie): void {
    if (!setCookie) return;
    for (const line of setCookie.getSetCookie()) {
      const [pair = '', ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '';
      if (expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
}

/** TOTP RFC 6238 (SHA-1, 6 digit, 30 detik), sama dengan aplikasi autentikator. */
export function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < key.length; i++) key[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0xf;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return n.toString().padStart(6, '0');
}

export function linkFromLastMail(h: Harness, param: string): string {
  const mail = h.mailer.sent.at(-1);
  if (!mail) throw new Error('tidak ada email');
  // Ambil tautan dari isi email lalu baca parameternya lewat URL, tanpa regex dinamis.
  for (const raw of mail.text.match(/https?:\/\/\S+/g) ?? []) {
    const value = new URL(raw).searchParams.get(param);
    if (value) return value;
  }
  throw new Error(`email tanpa parameter ${param}`);
}

/**
 * Amankan dengan TOTP + kode pemulihan lalu selesaikan (akun pertama atau terima undangan).
 * Mengembalikan rahasia TOTP dan kode pemulihan.
 */
export async function secureWithTotp(
  h: Harness,
  b: Browser,
): Promise<{ secret: string; codes: string[] }> {
  const begin = await h.service.totpBegin(b.headers(), PASSWORD);
  if (begin.kind !== 'ok') throw new Error(`TOTP tidak bisa dimulai: ${begin.kind}`);
  const confirm = await h.service.totpConfirm(b.headers(), totp(begin.secret));
  if (confirm.result.kind !== 'ok') throw new Error(`TOTP gagal: ${confirm.result.kind}`);
  b.absorb(confirm.setCookie);
  const codes = await h.service.createRecoveryCodes(b.headers());
  const done = await h.service.finishSecuring(b.headers());
  if (done.result.kind !== 'ok') throw new Error(`selesai gagal: ${done.result.kind}`);
  b.absorb(done.setCookie);
  return { secret: begin.secret, codes };
}

/** Pemilik lengkap: daftar, konfirmasi email, masuk, amankan. */
export async function bootstrapOwner(
  h: Harness,
): Promise<{ browser: Browser; secret: string; codes: string[] }> {
  const b = new Browser();
  await h.service.signUpOwner(b.headers(), 'Novanda', OWNER, PASSWORD);
  if (!(await h.service.verifyEmail(linkFromLastMail(h, 'token'))))
    throw new Error('verifikasi gagal');
  const signIn = await h.service.signInPassword(b.headers(), OWNER, PASSWORD);
  if (signIn.result.kind !== 'ok') throw new Error(`masuk gagal: ${signIn.result.kind}`);
  b.absorb(signIn.setCookie);
  const secured = await secureWithTotp(h, b);
  return { browser: b, ...secured };
}

export async function userId(h: Harness, email: string): Promise<string> {
  const { rows } = await h.admin.query<{ id: string }>(
    'select id from auth."user" where email = $1',
    [email],
  );
  if (!rows[0]) throw new Error('user tidak ada');
  return rows[0].id;
}
