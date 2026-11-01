import type { Route } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createPools } from '../db';
import { readServerEnv } from '../env';
import { LogMailer, ResendMailer } from './mailer';
import { SESSION_ABSOLUTE_MS } from './policy';
import { AuthService, type SessionState, type SetCookie } from './service';

/**
 * Sambungan AuthService ke Next (Server Component dan Server Action). Satu instance per proses.
 * `requireUser` adalah satu-satunya gerbang halaman data: sesi tanpa faktor kuat (enrolling,
 * kode pemulihan, atau kata sandi saja pada akun berpasskey) tidak pernah sampai ke data.
 */

let instance: AuthService | undefined;

export function authService(): AuthService {
  if (!instance) {
    const env = readServerEnv();
    const mailer = env.resendApiKey
      ? new ResendMailer(env.resendApiKey, env.emailFrom)
      : new LogMailer(true);
    instance = new AuthService(env, createPools(env.databaseUrl), mailer);
  }
  return instance;
}

export async function requestHeaders(): Promise<Headers> {
  return new Headers(await headers());
}

interface ParsedCookie {
  name: string;
  value: string;
  maxAge?: number;
  expires?: Date;
  path?: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
}

export function parseSetCookie(line: string): ParsedCookie | null {
  const [pair = '', ...attrs] = line.split(';');
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const out: ParsedCookie = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
    httpOnly: false,
    secure: false,
  };
  for (const attr of attrs) {
    const [k = '', v = ''] = attr.split('=').map((s) => s.trim());
    const key = k.toLowerCase();
    if (key === 'max-age') out.maxAge = Number(v);
    else if (key === 'expires') out.expires = new Date(v);
    else if (key === 'path') out.path = v;
    else if (key === 'httponly') out.httpOnly = true;
    else if (key === 'secure') out.secure = true;
    else if (key === 'samesite') {
      const s = v.toLowerCase();
      if (s === 'lax' || s === 'strict' || s === 'none') out.sameSite = s;
    }
  }
  return out;
}

/**
 * Pasang Set-Cookie Better Auth ke respons Next. Cookie sesi diberi umur 30 hari (batas absolut):
 * idle 7 hari ditegakkan baris sesi di DB, sehingga cookie tidak perlu diperbarui tiap request
 * (Server Component tidak bisa menulis cookie).
 */
export async function applySetCookie(setCookie: SetCookie): Promise<void> {
  if (!setCookie) return;
  const store = await cookies();
  for (const line of setCookie.getSetCookie()) {
    const c = parseSetCookie(line);
    if (!c) continue;
    const isSession = c.name.endsWith('.session_token');
    const maxAge =
      isSession && c.maxAge !== undefined && c.maxAge > 0 ? SESSION_ABSOLUTE_MS / 1000 : c.maxAge;
    store.set({
      name: c.name,
      value: c.value,
      httpOnly: c.httpOnly,
      secure: c.secure,
      path: c.path ?? '/',
      sameSite: c.sameSite ?? 'lax',
      ...(maxAge !== undefined ? { maxAge } : {}),
      ...(c.expires && maxAge === undefined ? { expires: c.expires } : {}),
    });
  }
}

/** Sesi request ini (dibaca dari DB). Penyegaran cookie diabaikan bila dipanggil dari render. */
export async function currentSession(): Promise<SessionState | null> {
  const { state, setCookie } = await authService().session(await requestHeaders());
  try {
    await applySetCookie(setCookie);
  } catch {
    // Server Component: cookie tidak bisa ditulis; idle dihitung dari baris sesi DB.
  }
  return state;
}

export type Level = 'full' | 'securing';

/**
 * Gerbang halaman dan Server Action. `full` = data (faktor kuat + akun diprovisikan);
 * `securing` = hanya /amankan. Menolak dengan redirect, tidak pernah mengembalikan sesi lemah
 * untuk level `full`.
 */
export async function requireUser(level: Level): Promise<SessionState> {
  const state = await currentSession();
  if (!state) redirect('/masuk');
  const { access } = state;
  if (access.kind === 'denied') redirect('/masuk?status=faktor');
  if (level === 'full' && access.kind !== 'full') redirect('/amankan');
  if (level === 'securing' && access.kind === 'full') redirect('/pribadi/beranda' as Route);
  return state;
}
