import { AsyncLocalStorage } from 'node:async_hooks';
import { passkey } from '@better-auth/passkey';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { haveIBeenPwned, twoFactor } from 'better-auth/plugins';
import * as z from 'zod';
import type { Pools } from '../db';
import type { ServerEnv } from '../env';
import { mails, type Mailer } from './mailer';
import { background } from './background';
import { FRESH_AGE_S, SESSION_IDLE_S, SESSION_UPDATE_AGE_S, amrForPath, type Amr } from './policy';

/**
 * Konfigurasi Better Auth 1.7.12 (ADR 0007). Opsi wajib TRD §3.4:
 * - kata sandi minimal 12 (BSD/AFD), maksimal 128, cek bocor HIBP;
 * - `revokeSessionsOnPasswordReset`, reset dan verifikasi lewat Resend;
 * - sesi di DB tanpa cookie cache, idle 7 hari (expiresIn + updateAge), absolut 30 hari
 *   ditegakkan `sessionAccess` dan saat cookie dipasang;
 * - cookie `__Host-` HttpOnly Secure SameSite=Lax Path=/;
 * - id UUID (kolom uuid, BSD §5), IP hanya dari X-Forwarded-For.
 * Handler HTTP Better Auth tidak dipasang: semua endpoint dipanggil dari Server Action lewat
 * `auth.api.*`, jadi permukaan publik = Server Action yang menegakkan aturan faktor kuat.
 */

/** Konteks pendaftaran dari tautan undangan yang sah: email terbukti milik pemegang tautan. */
export const inviteSignup = new AsyncLocalStorage<{ email: string }>();

/** Sesi yang dibuat di dalam konteks ini memakai `amr` ini (kode pemulihan, naik penuh). */
const amrOverride = new AsyncLocalStorage<Amr>();

/**
 * Endpoint server-only (tidak ada handler HTTP):
 * - `/recovery/sign-in`: kode sudah diverifikasi service; cabut semua sesi, buat sesi `recovery`.
 * - `/session/promote`: akhir /amankan; ganti sesi lama dengan sesi baru (token baru) ber-`amr`
 *   faktor kuat, sehingga token yang pernah beredar saat enrolling tidak ikut naik.
 */
const dompetkuSessions = () =>
  ({
    id: 'dompetku-sessions',
    endpoints: {
      recoverySignIn: createAuthEndpoint.serverOnly(
        { path: '/recovery/sign-in', method: 'POST', body: z.object({ userId: z.uuid() }) },
        async (ctx) => {
          const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
          if (!user) throw new Error('user tidak ditemukan');
          await ctx.context.internalAdapter.deleteUserSessions(user.id);
          const session = await amrOverride.run('recovery', () =>
            ctx.context.internalAdapter.createSession(user.id),
          );
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ userId: user.id });
        },
      ),
      promoteSession: createAuthEndpoint.serverOnly(
        {
          path: '/session/promote',
          method: 'POST',
          body: z.object({
            userId: z.uuid(),
            token: z.string().min(1),
            amr: z.enum(['passkey', 'password+totp']),
          }),
        },
        async (ctx) => {
          const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
          if (!user) throw new Error('user tidak ditemukan');
          const session = await amrOverride.run(ctx.body.amr, () =>
            ctx.context.internalAdapter.createSession(user.id),
          );
          await ctx.context.internalAdapter.deleteSession(ctx.body.token);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ token: session.token });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;

export interface AuthDeps {
  env: ServerEnv;
  pools: Pools;
  mailer: Mailer;
  /** Dipanggil setelah reset kata sandi berhasil (audit). */
  onPasswordReset?: (userId: string) => Promise<void>;
}

export function cookiePrefix(env: ServerEnv): string {
  return env.secureCookies ? '__Host-dompetku' : 'dompetku';
}

export function createAuth({ env, pools, mailer, onPasswordReset }: AuthDeps) {
  return betterAuth({
    appName: 'DompetKu',
    baseURL: env.baseURL,
    secret: env.authSecret,
    database: pools.auth,
    telemetry: { enabled: false },
    trustedOrigins: [env.baseURL],
    // Tanpa handler HTTP, rate limit bawaan tidak berlaku; jeda gagal login di throttle.ts.
    rateLimit: { enabled: false },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: true,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      sendResetPassword: async ({ user, token }) => {
        const url = `${env.baseURL}/lupa-sandi/atur?token=${encodeURIComponent(token)}`;
        // Di latar: respons tidak menunggu Resend (waktu sama untuk email terdaftar/tidak).
        background(mailer.send(mails.resetPassword(user.email, url)));
        await Promise.resolve();
      },
      onPasswordReset: async ({ user }) => {
        await onPasswordReset?.(user.id);
      },
    },
    emailVerification: {
      sendOnSignUp: false,
      autoSignInAfterVerification: false,
      expiresIn: 24 * 60 * 60,
      sendVerificationEmail: async ({ user, token }) => {
        const url = `${env.baseURL}/verifikasi-email?token=${encodeURIComponent(token)}`;
        background(mailer.send(mails.verifyEmail(user.email, url)));
        await Promise.resolve();
      },
    },
    // Email terikat undangan/owner_email dan dikunci trigger user_email_immutable (DK422).
    user: { changeEmail: { enabled: false } },
    account: { accountLinking: { enabled: false } },
    session: {
      expiresIn: SESSION_IDLE_S,
      updateAge: SESSION_UPDATE_AGE_S,
      freshAge: FRESH_AGE_S,
      cookieCache: { enabled: false },
      additionalFields: { amr: { type: 'string', required: false, input: false } },
    },
    advanced: {
      // Tugas latar Better Auth (runInBackgroundOrAwait) tidak ditunggu respons.
      backgroundTasks: { handler: (task) => void task },
      database: { generateId: 'uuid' },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
      useSecureCookies: false,
      cookiePrefix: cookiePrefix(env),
      defaultCookieAttributes: {
        secure: env.secureCookies,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: (user) => {
            const email = user.email.trim().toLowerCase();
            const invited = inviteSignup.getStore()?.email === email;
            return Promise.resolve({
              data: { ...user, email, ...(invited ? { emailVerified: true } : {}) },
            });
          },
        },
      },
      session: {
        create: {
          before: (session, ctx) =>
            Promise.resolve({
              data: {
                ...session,
                amr: amrOverride.getStore() ?? amrForPath(ctx?.path),
              },
            }),
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: 'DompetKu',
        // Faktor didaftarkan di /amankan; aturan siapa boleh mendaftar ada di sessionAccess.
        allowPasswordless: true,
        skipVerificationOnEnable: false,
      }),
      passkey({
        rpID: env.rpID,
        rpName: 'DompetKu',
        origin: env.baseURL,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      }),
      ...(env.checkPwnedPasswords
        ? [
            haveIBeenPwned({
              customPasswordCompromisedMessage: 'PASSWORD_COMPROMISED',
            }),
          ]
        : []),
      dompetkuSessions(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
