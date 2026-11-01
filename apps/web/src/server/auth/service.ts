import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser';
import { isAPIError } from 'better-auth/api';
import { domainError, withAnon, withUser, type Pools } from '../db';
import type { ServerEnv } from '../env';
import { createAuth, inviteSignup, type Auth } from './config';
import { mails, type Mailer } from './mailer';
import { sessionAccess, STRONG_AMR, isAmr, type Access, type Amr } from './policy';
import {
  DUMMY_RECOVERY_HASH,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyRecoveryCode,
} from './recovery-codes';
import {
  clearFailures,
  pruneThrottle,
  recordFailure,
  remainingDelay,
  throttleKey,
  type ThrottleKind,
} from './throttle';

/**
 * Lapisan auth di atas Better Auth (BSD §5, §9.3; AFD §1, §2, §6). Tidak bergantung pada Next:
 * menerima header request dan mengembalikan header `Set-Cookie` yang dipasang pemanggil, sehingga
 * dipakai Server Action dan tes integrasi yang sama.
 */

export type SetCookie = Headers | null;

export interface SessionState {
  sessionId: string;
  sessionCreatedAt: Date;
  amr: Amr | null;
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  hasPasskey: boolean;
  hasTotp: boolean;
  provisioned: boolean;
  access: Access;
}

type Weak = 'too_short' | 'too_long' | 'compromised';

export type SignInResult =
  | { kind: 'ok'; next: 'beranda' | 'amankan' }
  | { kind: 'totp' }
  | { kind: 'invalid' }
  | { kind: 'use_passkey' }
  | { kind: 'throttled'; seconds: number };

export type TotpResult =
  | { kind: 'ok'; next: 'beranda' | 'amankan' }
  | { kind: 'invalid' }
  | { kind: 'restart' }
  | { kind: 'throttled'; seconds: number };

export type FinishResult =
  | { kind: 'ok' }
  | {
      kind:
        | 'no_factor'
        | 'no_recovery_codes'
        | 'email_unverified'
        | 'invite_invalid'
        | 'user_limit'
        | 'not_allowed';
    };

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();

export function inviteTokenHash(token: string): Buffer {
  return sha256(token.trim());
}

export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** IP klien: hanya X-Forwarded-For satu nilai dari edge (TRD §3.4); selain itu null. */
export function clientIp(headers: Headers): string | null {
  const raw = headers.get('x-forwarded-for')?.trim() ?? '';
  return isIP(raw) === 0 ? null : raw;
}

function apiCode(e: unknown): string | null {
  if (!isAPIError(e)) return null;
  const body = e.body as { code?: unknown } | undefined;
  return typeof body?.code === 'string' ? body.code : null;
}

function weakPassword(e: unknown): Weak | null {
  const code = apiCode(e);
  if (code === 'PASSWORD_TOO_SHORT') return 'too_short';
  if (code === 'PASSWORD_TOO_LONG') return 'too_long';
  if (code === 'PASSWORD_COMPROMISED') return 'compromised';
  return null;
}

export class AuthService {
  readonly auth: Auth;

  constructor(
    readonly env: ServerEnv,
    readonly pools: Pools,
    readonly mailer: Mailer,
  ) {
    this.auth = createAuth({
      env,
      pools,
      mailer,
      onPasswordReset: (userId) => this.audit(userId, 'password_reset_done'),
    });
  }

  // ===== Audit =====

  /** audit.log: user_id dari konteks (tidak bisa dipalsukan), meta daftar tertutup (BSD §10). */
  async audit(
    userId: string | null,
    event: string,
    headers?: Headers,
    meta: Record<string, string | number> = {},
  ): Promise<void> {
    const args = [
      event,
      headers ? clientIp(headers) : null,
      headers?.get('user-agent')?.slice(0, 200) ?? null,
      JSON.stringify(meta),
    ];
    const sql = 'select audit.log($1, $2::inet, $3, null, $4::jsonb)';
    if (userId === null) await withAnon(this.pools.app, (c) => c.query(sql, args));
    else await withUser(this.pools.app, userId, (c) => c.query(sql, args));
  }

  // ===== Sesi =====

  async session(headers: Headers): Promise<{ state: SessionState | null; setCookie: SetCookie }> {
    const { headers: setCookie, response } = await this.auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
      returnHeaders: true,
    });
    if (!response) return { state: null, setCookie };
    const { session, user } = response;
    const facts = await this.userFacts(user.id);
    const amr = isAmr(session.amr) ? session.amr : null;
    const access = sessionAccess({
      amr,
      createdAt: new Date(session.createdAt),
      now: new Date(),
      hasStrongFactor: facts.hasPasskey || facts.hasTotp,
      provisioned: facts.provisioned,
    });
    if (access.kind === 'denied' && access.reason === 'expired') {
      await this.pools.auth.query('delete from auth.session where id = $1', [session.id]);
      return { state: null, setCookie };
    }
    return {
      setCookie,
      state: {
        sessionId: session.id,
        sessionCreatedAt: new Date(session.createdAt),
        amr,
        userId: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        ...facts,
        access,
      },
    };
  }

  private async userFacts(
    userId: string,
  ): Promise<{ hasPasskey: boolean; hasTotp: boolean; provisioned: boolean }> {
    const { rows } = await this.pools.auth.query<{ passkey: boolean; totp: boolean }>(
      `select exists (select 1 from auth.passkey where "userId" = $1) as passkey,
              exists (select 1 from auth."twoFactor" where "userId" = $1 and verified is not false)
                and coalesce((select "twoFactorEnabled" from auth."user" where id = $1), false) as totp`,
      [userId],
    );
    const provisioned = await withUser(this.pools.app, userId, async (c) => {
      const r = await c.query<{ ok: boolean }>(
        'select exists (select 1 from app.profiles where user_id = $1) as ok',
        [userId],
      );
      return r.rows[0]?.ok === true;
    });
    return { hasPasskey: rows[0]?.passkey === true, hasTotp: rows[0]?.totp === true, provisioned };
  }

  async signOut(headers: Headers): Promise<SetCookie> {
    const state = (await this.session(headers)).state;
    const { headers: setCookie } = await this.auth.api.signOut({ headers, returnHeaders: true });
    if (state) await this.audit(state.userId, 'logout', headers);
    return setCookie;
  }

  // ===== Jeda gagal =====

  private keys(kind: ThrottleKind, headers: Headers, account: string | null): Buffer[] {
    const keys: Buffer[] = [];
    const ip = clientIp(headers);
    if (ip) keys.push(throttleKey(kind, 'ip', ip));
    if (account) keys.push(throttleKey(kind, 'akun', account));
    return keys;
  }

  private async fail(
    keys: Buffer[],
    notifyEmail: string | null,
  ): Promise<{ kind: 'invalid' } | { kind: 'throttled'; seconds: number }> {
    const { failures, delay } = await recordFailure(this.pools.auth, keys);
    // Email pemberitahuan saat jeda 1 jam pertama (TRD §3.4), hanya ke akun yang ada.
    if (notifyEmail && failures.at(-1) === 20) {
      await this.mailer.send(mails.passwordPaused(notifyEmail)).catch(() => undefined);
    }
    if (Math.random() < 0.05) await pruneThrottle(this.pools.auth);
    return delay > 0 ? { kind: 'throttled', seconds: delay } : { kind: 'invalid' };
  }

  private async userIdByEmail(email: string): Promise<{ id: string; email: string } | null> {
    const { rows } = await this.pools.auth.query<{ id: string; email: string }>(
      'select id, email from auth."user" where email = $1',
      [email.trim().toLowerCase()],
    );
    return rows[0] ?? null;
  }

  // ===== Masuk =====

  async signInPassword(
    headers: Headers,
    email: string,
    password: string,
  ): Promise<{ result: SignInResult; setCookie: SetCookie }> {
    const normalized = email.trim().toLowerCase();
    const keys = this.keys('password', headers, normalized);
    const wait = await remainingDelay(this.pools.auth, keys);
    if (wait > 0) return { result: { kind: 'throttled', seconds: wait }, setCookie: null };
    let res;
    try {
      res = await this.auth.api.signInEmail({
        body: { email: normalized, password, rememberMe: true },
        headers,
        returnHeaders: true,
      });
    } catch (e) {
      if (!isAPIError(e)) throw e;
      const user = await this.userIdByEmail(normalized);
      await this.audit(null, 'login_failed', headers, { method: 'password' });
      return { result: await this.fail(keys, user?.email ?? null), setCookie: null };
    }
    await clearFailures(this.pools.auth, keys.slice(-1));
    if ('twoFactorRedirect' in res.response) {
      return { result: { kind: 'totp' }, setCookie: res.headers };
    }
    const userId = res.response.user.id;
    const facts = await this.userFacts(userId);
    if (facts.hasPasskey || facts.hasTotp) {
      // Akun berpasskey: kata sandi saja tidak membuka apa pun. Sesi dibuang, pengguna diarahkan
      // ke passkey atau kode pemulihan.
      await this.pools.auth.query('delete from auth.session where token = $1', [
        res.response.token,
      ]);
      return { result: { kind: 'use_passkey' }, setCookie: null };
    }
    await this.audit(userId, 'login_success', headers, { amr: 'password' });
    return { result: { kind: 'ok', next: 'amankan' }, setCookie: res.headers };
  }

  /** Langkah kedua masuk: kode TOTP (cookie tantangan dari signInPassword). */
  async verifyTotpSignIn(
    headers: Headers,
    code: string,
  ): Promise<{ result: TotpResult; setCookie: SetCookie }> {
    const keys = this.keys('totp', headers, null);
    const wait = await remainingDelay(this.pools.auth, keys);
    if (wait > 0) return { result: { kind: 'throttled', seconds: wait }, setCookie: null };
    try {
      const res = await this.auth.api.verifyTOTP({
        body: { code: code.replace(/\D/g, ''), trustDevice: false },
        headers,
        returnHeaders: true,
      });
      const userId = res.response.user.id;
      await clearFailures(this.pools.auth, keys);
      await this.audit(userId, 'login_success', headers, { amr: 'password+totp' });
      const facts = await this.userFacts(userId);
      return {
        result: { kind: 'ok', next: facts.provisioned ? 'beranda' : 'amankan' },
        setCookie: res.headers,
      };
    } catch (e) {
      const code = apiCode(e);
      if (code === 'INVALID_CODE') {
        await this.audit(null, 'login_failed', headers, { method: 'totp' });
        return { result: await this.fail(keys, null), setCookie: null };
      }
      if (code === 'ACCOUNT_TEMPORARILY_LOCKED')
        return { result: { kind: 'throttled', seconds: 15 * 60 }, setCookie: null };
      if (isAPIError(e)) return { result: { kind: 'restart' }, setCookie: null };
      throw e;
    }
  }

  async passkeyAuthenticationOptions(headers: Headers): Promise<{
    options: unknown;
    setCookie: SetCookie;
  }> {
    const res = await this.auth.api.generatePasskeyAuthenticationOptions({
      headers,
      returnHeaders: true,
    });
    return { options: res.response, setCookie: res.headers };
  }

  async passkeySignIn(
    headers: Headers,
    response: AuthenticationResponseJSON,
  ): Promise<{
    result: { kind: 'ok'; next: 'beranda' | 'amankan' } | { kind: 'failed' };
    setCookie: SetCookie;
  }> {
    try {
      const res = await this.auth.api.verifyPasskeyAuthentication({
        body: { response },
        headers,
        returnHeaders: true,
      });
      const userId = res.response.user.id;
      await this.audit(userId, 'login_success', headers, { amr: 'passkey' });
      const facts = await this.userFacts(userId);
      return {
        result: { kind: 'ok', next: facts.provisioned ? 'beranda' : 'amankan' },
        setCookie: res.headers,
      };
    } catch (e) {
      if (!isAPIError(e)) throw e;
      await this.audit(null, 'login_failed', headers, { method: 'passkey' });
      return { result: { kind: 'failed' }, setCookie: null };
    }
  }

  /**
   * Masuk dengan kode pemulihan (BSD §5): kode hangus, semua sesi lain dicabut, sesi `recovery`
   * hanya membuka /amankan, audit `recovery_code_used`, email pemberitahuan.
   */
  async recoverySignIn(
    headers: Headers,
    email: string,
    code: string,
  ): Promise<{
    result: { kind: 'ok' } | { kind: 'invalid' } | { kind: 'throttled'; seconds: number };
    setCookie: SetCookie;
  }> {
    const normalized = email.trim().toLowerCase();
    const keys = this.keys('recovery', headers, normalized);
    const wait = await remainingDelay(this.pools.auth, keys);
    if (wait > 0) return { result: { kind: 'throttled', seconds: wait }, setCookie: null };
    const user = await this.userIdByEmail(normalized);
    const { rows } = user
      ? await this.pools.auth.query<{ code_hash: string }>(
          'select code_hash from auth.recovery_codes where user_id = $1 and used_at is null',
          [user.id],
        )
      : { rows: [] };
    let matched: string | null = null;
    // Selalu minimal satu verifikasi agar waktu respons tidak membedakan email terdaftar.
    for (const { code_hash } of rows.length > 0 ? rows : [{ code_hash: DUMMY_RECOVERY_HASH }]) {
      if (normalizeRecoveryCode(code) !== null && (await verifyRecoveryCode(code, code_hash))) {
        matched = code_hash;
        break;
      }
    }
    if (!user || matched === null) {
      await this.audit(null, 'login_failed', headers, { method: 'recovery' });
      return { result: await this.fail(keys, null), setCookie: null };
    }
    const consumed = await this.pools.auth.query(
      `update auth.recovery_codes set used_at = now()
        where user_id = $1 and code_hash = $2 and used_at is null`,
      [user.id, matched],
    );
    if (consumed.rowCount !== 1) return { result: { kind: 'invalid' }, setCookie: null };
    await clearFailures(this.pools.auth, keys);
    const res = await this.auth.api.recoverySignIn({
      body: { userId: user.id },
      headers,
      returnHeaders: true,
    });
    await this.audit(user.id, 'recovery_code_used', headers);
    await this.audit(user.id, 'session_revoked', headers, { reason: 'recovery' });
    await this.mailer.send(mails.recoveryCodeUsed(user.email)).catch(() => undefined);
    return { result: { kind: 'ok' }, setCookie: res.headers };
  }

  // ===== Daftar =====

  /**
   * Akun pertama (keputusan pemilik #5): hanya email `app.settings.owner_email`, dan hanya
   * sebelum rumah tangga ada (trigger user_admission). Respons selalu "periksa email", apa pun
   * hasilnya; tidak ada sesi yang dibuat. Sesi pertama lahir di /masuk setelah email dikonfirmasi.
   */
  async signUpOwner(
    headers: Headers,
    name: string,
    email: string,
    password: string,
  ): Promise<
    | { kind: 'check_email' }
    | { kind: 'weak'; reason: Weak }
    | { kind: 'throttled'; seconds: number }
  > {
    const normalized = email.trim().toLowerCase();
    const keys = this.keys('signup', headers, null);
    const wait = await remainingDelay(this.pools.auth, keys);
    if (wait > 0) return { kind: 'throttled', seconds: wait };
    const owner = await withAnon(this.pools.app, async (c) => {
      const r = await c.query<{ value: string }>(
        "select value from app.settings where key = 'owner_email'",
      );
      return r.rows[0]?.value ?? null;
    });
    if (owner === null || owner !== normalized) {
      await recordFailure(this.pools.auth, keys);
      return { kind: 'check_email' };
    }
    try {
      const res = await this.auth.api.signUpEmail({
        body: { name: name.trim(), email: normalized, password, rememberMe: true },
        headers,
      });
      await this.pools.auth.query('delete from auth.session where "userId" = $1', [res.user.id]);
      await this.auth.api.sendVerificationEmail({ body: { email: normalized } });
    } catch (e) {
      const weak = weakPassword(e);
      if (weak) return { kind: 'weak', reason: weak };
      if (!isAPIError(e)) throw e;
      // Sudah terdaftar atau ditolak trigger: tetap respons seragam. Belum terverifikasi = kirim ulang.
      const existing = await this.userIdByEmail(normalized);
      if (existing)
        await this.auth.api
          .sendVerificationEmail({ body: { email: normalized } })
          .catch(() => undefined);
    }
    return { kind: 'check_email' };
  }

  async verifyEmail(token: string): Promise<boolean> {
    try {
      await this.auth.api.verifyEmail({ query: { token } });
      return true;
    } catch (e) {
      if (isAPIError(e)) return false;
      throw e;
    }
  }

  async peekInvitation(token: string): Promise<{ email: string; expiresAt: string } | null> {
    if (token.trim() === '') return null;
    try {
      return await withAnon(this.pools.app, async (c) => {
        const r = await c.query<{ peek: { email: string; expires_at: string } }>(
          'select api.invitation_peek($1) as peek',
          [inviteTokenHash(token)],
        );
        const peek = r.rows[0]?.peek;
        return peek ? { email: peek.email, expiresAt: peek.expires_at } : null;
      });
    } catch (e) {
      if (domainError(e)) return null;
      throw e;
    }
  }

  async declineInvitation(headers: Headers, token: string): Promise<boolean> {
    try {
      await withAnon(this.pools.app, (c) =>
        c.query('select api.decline_invitation($1)', [inviteTokenHash(token)]),
      );
      await this.audit(null, 'invitation_declined', headers);
      return true;
    } catch (e) {
      if (domainError(e)) return false;
      throw e;
    }
  }

  /**
   * Daftar dari tautan undangan (AFD §1): email dari token, `emailVerified` = true (tautan
   * membuktikan kotak masuk), sesi `password` (enrolling). Undangan baru dipakai di finishSecuring.
   */
  async signUpInvitee(
    headers: Headers,
    token: string,
    name: string,
    password: string,
  ): Promise<{
    result:
      | { kind: 'ok' }
      | { kind: 'invite_invalid' }
      | { kind: 'account_exists' }
      | { kind: 'weak'; reason: Weak };
    setCookie: SetCookie;
  }> {
    const invite = await this.peekInvitation(token);
    if (!invite) return { result: { kind: 'invite_invalid' }, setCookie: null };
    if (await this.userIdByEmail(invite.email))
      return { result: { kind: 'account_exists' }, setCookie: null };
    try {
      const res = await inviteSignup.run({ email: invite.email }, () =>
        this.auth.api.signUpEmail({
          body: { name: name.trim(), email: invite.email, password, rememberMe: true },
          headers,
          returnHeaders: true,
        }),
      );
      const userId = res.response.user.id;
      await this.pools.auth.query(
        `insert into auth.verification (identifier, value, "expiresAt")
         values ($1, $2, $3)`,
        [`undangan:${userId}`, inviteTokenHash(token).toString('hex'), invite.expiresAt],
      );
      return { result: { kind: 'ok' }, setCookie: res.headers };
    } catch (e) {
      const weak = weakPassword(e);
      if (weak) return { result: { kind: 'weak', reason: weak }, setCookie: null };
      if (isAPIError(e)) return { result: { kind: 'invite_invalid' }, setCookie: null };
      throw e;
    }
  }

  // ===== Lupa kata sandi =====

  async requestPasswordReset(
    headers: Headers,
    email: string,
  ): Promise<{ kind: 'sent' } | { kind: 'throttled'; seconds: number }> {
    const keys = this.keys('reset', headers, email.trim().toLowerCase());
    const wait = await remainingDelay(this.pools.auth, keys);
    if (wait > 0) return { kind: 'throttled', seconds: wait };
    // Hitung setiap permintaan sebagai "percobaan" agar email tidak bisa dibanjiri.
    await recordFailure(this.pools.auth, keys);
    try {
      await this.auth.api.requestPasswordReset({ body: { email: email.trim().toLowerCase() } });
      const user = await this.userIdByEmail(email);
      if (user) await this.audit(user.id, 'password_reset_requested', headers);
    } catch (e) {
      if (!isAPIError(e)) throw e;
    }
    return { kind: 'sent' };
  }

  async resetPassword(
    token: string,
    password: string,
  ): Promise<{ kind: 'ok' } | { kind: 'invalid' } | { kind: 'weak'; reason: Weak }> {
    try {
      await this.auth.api.resetPassword({ body: { token, newPassword: password } });
      return { kind: 'ok' };
    } catch (e) {
      const weak = weakPassword(e);
      if (weak) return { kind: 'weak', reason: weak };
      if (isAPIError(e)) return { kind: 'invalid' };
      throw e;
    }
  }

  // ===== Amankan =====

  /** Faktor baru boleh didaftarkan hanya oleh sesi `securing` (policy) yang masih segar. */
  private assertSecuring(state: SessionState | null): asserts state is SessionState {
    if (state?.access.kind !== 'securing') throw new Error('sesi tidak boleh mendaftar faktor');
  }

  /** Mulai TOTP: kata sandi diminta ulang (step-up Better Auth untuk akun berkata sandi). */
  async totpBegin(
    headers: Headers,
    password: string,
  ): Promise<{ kind: 'ok'; uri: string; secret: string } | { kind: 'wrong_password' | 'already' }> {
    const { state } = await this.session(headers);
    this.assertSecuring(state);
    if (state.hasTotp) return { kind: 'already' };
    const keys = [throttleKey('password', 'akun', state.email)];
    try {
      const res = await this.auth.api.enableTwoFactor({ body: { password }, headers });
      if (!('totpURI' in res) || typeof res.totpURI !== 'string') return { kind: 'already' };
      const secret = new URL(res.totpURI).searchParams.get('secret') ?? '';
      return { kind: 'ok', uri: res.totpURI, secret };
    } catch (e) {
      if (apiCode(e) === 'INVALID_PASSWORD') {
        await recordFailure(this.pools.auth, keys);
        return { kind: 'wrong_password' };
      }
      throw e;
    }
  }

  async totpConfirm(
    headers: Headers,
    code: string,
  ): Promise<{
    result: { kind: 'ok' } | { kind: 'invalid' } | { kind: 'throttled'; seconds: number };
    setCookie: SetCookie;
  }> {
    const { state } = await this.session(headers);
    this.assertSecuring(state);
    const keys = [throttleKey('totp', 'akun', state.userId)];
    const wait = await remainingDelay(this.pools.auth, keys);
    if (wait > 0) return { result: { kind: 'throttled', seconds: wait }, setCookie: null };
    try {
      const res = await this.auth.api.verifyTOTP({
        body: { code: code.replace(/\D/g, '') },
        headers,
        returnHeaders: true,
      });
      await clearFailures(this.pools.auth, keys);
      await this.audit(state.userId, 'factor_added', headers, { method: 'totp' });
      return { result: { kind: 'ok' }, setCookie: res.headers };
    } catch (e) {
      if (apiCode(e) === 'INVALID_CODE') {
        const r = await this.fail(keys, null);
        return { result: r, setCookie: null };
      }
      throw e;
    }
  }

  async passkeyRegistrationOptions(
    headers: Headers,
  ): Promise<{ options: unknown; setCookie: SetCookie } | { stale: true }> {
    const { state } = await this.session(headers);
    this.assertSecuring(state);
    try {
      const res = await this.auth.api.generatePasskeyRegistrationOptions({
        headers,
        query: { name: 'Passkey' },
        returnHeaders: true,
      });
      return { options: res.response, setCookie: res.headers };
    } catch (e) {
      if (apiCode(e) === 'SESSION_NOT_FRESH') return { stale: true };
      throw e;
    }
  }

  async passkeyRegister(headers: Headers, response: RegistrationResponseJSON): Promise<boolean> {
    const { state } = await this.session(headers);
    this.assertSecuring(state);
    try {
      await this.auth.api.verifyPasskeyRegistration({ body: { response }, headers });
      await this.audit(state.userId, 'factor_added', headers, { method: 'passkey' });
      return true;
    } catch (e) {
      if (isAPIError(e)) return false;
      throw e;
    }
  }

  /** Sesi ini sudah membuktikan faktor kuat: masuk dengan faktor kuat, atau passkey dibuat di sesi ini. */
  private async strongInSession(state: SessionState): Promise<Amr | null> {
    if (state.amr !== null && STRONG_AMR.includes(state.amr)) return state.amr;
    const { rows } = await this.pools.auth.query<{ ok: boolean }>(
      `select exists (select 1 from auth.passkey where "userId" = $1 and "createdAt" >= $2) as ok`,
      [state.userId, state.sessionCreatedAt],
    );
    return rows[0]?.ok === true ? 'passkey' : null;
  }

  async securingStep(state: SessionState): Promise<'verifikasi-email' | 'faktor' | 'pemulihan'> {
    if (!state.emailVerified) return 'verifikasi-email';
    return (await this.strongInSession(state)) === null ? 'faktor' : 'pemulihan';
  }

  /** Buat ulang 10 kode pemulihan (yang lama hangus). Ditampilkan sekali. */
  async createRecoveryCodes(headers: Headers): Promise<string[]> {
    const { state } = await this.session(headers);
    this.assertSecuring(state);
    if ((await this.strongInSession(state)) === null) throw new Error('faktor kuat belum ada');
    const codes = generateRecoveryCodes();
    const hashes = await Promise.all(codes.map(hashRecoveryCode));
    const client = await this.pools.auth.connect();
    try {
      await client.query('begin');
      await client.query('delete from auth.recovery_codes where user_id = $1', [state.userId]);
      await client.query(
        'insert into auth.recovery_codes (user_id, code_hash) select $1, unnest($2::text[])',
        [state.userId, hashes],
      );
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    await this.audit(state.userId, 'recovery_codes_regenerated', headers, { count: codes.length });
    return codes;
  }

  /**
   * Langkah terakhir /amankan: akun pertama dibuat atau undangan diterima (fungsi undangan di
   * transaksi sendiri), lalu sesi naik penuh dengan `amr` faktor kuat yang dibuktikan.
   */
  async finishSecuring(headers: Headers): Promise<FinishResult> {
    const { state } = await this.session(headers);
    if (!state || (state.access.kind !== 'securing' && state.access.kind !== 'full'))
      return { kind: 'not_allowed' };
    if (!state.emailVerified) return { kind: 'email_unverified' };
    const amr = await this.strongInSession(state);
    if (amr === null) return { kind: 'no_factor' };
    const { rows: codes } = await this.pools.auth.query(
      `select 1 from auth.recovery_codes where user_id = $1 and used_at is null and created_at >= $2`,
      [state.userId, state.sessionCreatedAt],
    );
    if (codes.length === 0) return { kind: 'no_recovery_codes' };

    if (!state.provisioned) {
      const { rows } = await this.pools.auth.query<{ value: string }>(
        `select value from auth.verification where identifier = $1 and "expiresAt" > now()`,
        [`undangan:${state.userId}`],
      );
      const pending = rows[0]?.value ?? null;
      try {
        if (pending !== null) {
          await withUser(this.pools.app, state.userId, (c) =>
            c.query('select api.accept_invitation($1, $2)', [
              Buffer.from(pending, 'hex'),
              state.name,
            ]),
          );
          await this.audit(state.userId, 'invitation_accepted', headers);
        } else {
          await withUser(this.pools.app, state.userId, (c) =>
            c.query('select api.bootstrap_owner($1)', [state.name]),
          );
        }
      } catch (e) {
        const d = domainError(e);
        if (!d) throw e;
        if (d.message === 'user_limit') return { kind: 'user_limit' };
        if (d.message === 'email_unverified') return { kind: 'email_unverified' };
        if (d.message === 'not_secured') return { kind: 'no_recovery_codes' };
        if (d.message.startsWith('invitation_')) return { kind: 'invite_invalid' };
        return { kind: 'not_allowed' };
      }
      await this.pools.auth.query('delete from auth.verification where identifier = $1', [
        `undangan:${state.userId}`,
      ]);
    }
    if (state.amr !== amr)
      await this.pools.auth.query('update auth.session set amr = $2 where id = $1', [
        state.sessionId,
        amr,
      ]);
    return { kind: 'ok' };
  }

  // ===== Undangan (pemilik, sesi penuh) =====

  async household(userId: string): Promise<{ role: 'owner' | 'member'; members: number } | null> {
    return withUser(this.pools.app, userId, async (c) => {
      const r = await c.query<{ role: 'owner' | 'member'; members: number }>(
        `select m.role, (select count(*) from app.space_members x where x.space_id = s.id)::int as members
           from app.spaces s join app.space_members m on m.space_id = s.id
          where s.kind = 'shared' and m.user_id = $1`,
        [userId],
      );
      return r.rows[0] ?? null;
    });
  }

  async listInvitations(
    userId: string,
  ): Promise<{ id: string; email: string; createdAt: Date; expiresAt: Date; status: string }[]> {
    return withUser(this.pools.app, userId, async (c) => {
      const r = await c.query<{
        id: string;
        email: string;
        created_at: Date;
        expires_at: Date;
        status: string;
      }>('select * from api.list_invitations()');
      return r.rows.map((x) => ({
        id: x.id,
        email: x.email,
        createdAt: x.created_at,
        expiresAt: x.expires_at,
        status: x.status,
      }));
    });
  }

  private async sendInvitation(email: string, inviter: string, token: string): Promise<void> {
    const url = `${this.env.baseURL}/terima-undangan?t=${encodeURIComponent(token)}`;
    await this.mailer.send(mails.invitation(email, inviter, url));
  }

  async createInvitation(
    headers: Headers,
    userId: string,
    inviter: string,
    email: string,
  ): Promise<
    | { kind: 'sent'; email: string }
    | { kind: 'open_exists' | 'user_limit' | 'not_owner' | 'invalid_email' }
  > {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254)
      return { kind: 'invalid_email' };
    const token = newInviteToken();
    try {
      await withUser(this.pools.app, userId, (c) =>
        c.query('select api.create_invitation($1, $2)', [normalized, inviteTokenHash(token)]),
      );
    } catch (e) {
      const d = domainError(e);
      if (!d) throw e;
      if (d.code === '23505') return { kind: 'open_exists' };
      if (d.message === 'user_limit') return { kind: 'user_limit' };
      if (d.code === '23514') return { kind: 'invalid_email' };
      return { kind: 'not_owner' };
    }
    await this.sendInvitation(normalized, inviter, token);
    await this.audit(userId, 'invitation_created', headers);
    return { kind: 'sent', email: normalized };
  }

  async revokeInvitation(headers: Headers, userId: string, id: string): Promise<boolean> {
    try {
      await withUser(this.pools.app, userId, (c) =>
        c.query('select api.revoke_invitation($1)', [id]),
      );
      await this.audit(userId, 'invitation_revoked', headers);
      return true;
    } catch (e) {
      if (domainError(e)) return false;
      throw e;
    }
  }

  async resendInvitation(
    headers: Headers,
    userId: string,
    inviter: string,
    id: string,
    email: string | null,
  ): Promise<{ kind: 'sent'; email: string } | { kind: 'not_found' | 'invalid_email' }> {
    const token = newInviteToken();
    const trimmed = email?.trim().toLowerCase() ?? '';
    const corrected = trimmed === '' ? null : trimmed;
    if (corrected !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(corrected))
      return { kind: 'invalid_email' };
    try {
      const sentTo = await withUser(this.pools.app, userId, async (c) => {
        await c.query('select api.resend_invitation($1, $2, $3)', [
          id,
          corrected,
          inviteTokenHash(token),
        ]);
        const r = await c.query<{ email: string }>(
          'select email from api.list_invitations() where status = $1 limit 1',
          ['pending'],
        );
        return r.rows[0]?.email ?? null;
      });
      if (sentTo === null) return { kind: 'not_found' };
      await this.sendInvitation(sentTo, inviter, token);
      await this.audit(userId, 'invitation_revoked', headers, { reason: 'resent' });
      await this.audit(userId, 'invitation_created', headers);
      return { kind: 'sent', email: sentTo };
    } catch (e) {
      const d = domainError(e);
      if (!d) throw e;
      return { kind: d.code === '23514' ? 'invalid_email' : 'not_found' };
    }
  }
}
