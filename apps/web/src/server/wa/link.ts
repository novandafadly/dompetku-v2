import 'server-only';
import { z } from 'zod';
import { withUser, type Pools } from '../db';
import { readWaEnv } from './config';

/**
 * Tautan nomor WhatsApp milik user yang masuk (spec 4.3, 5.6). Semua kueri lewat `withUser`
 * (RLS baris sendiri); tidak ada parameter id user dari klien. Nomor lengkap tidak pernah keluar
 * dari modul ini: pemanggil hanya menerima versi yang disamarkan.
 */

export interface WaCtx {
  pools: Pools;
  userId: string;
}

export type WaLinkStatus =
  /** Fitur belum dinyalakan di server (`readWaEnv()` null atau konfigurasi tidak sah). */
  | { state: 'off' }
  | { state: 'unlinked'; botNumber: string | null }
  | { state: 'linked'; masked: string; botNumber: string | null };

/**
 * `+6281234567889` -> `+62 812••••89`. Kode negara Indonesia dikenali; nomor lain hanya
 * menampilkan dua digit awal dan dua digit akhir. Nilai di luar bentuk E.164 tidak ditampilkan
 * sama sekali.
 */
export function maskPhone(e164: string): string {
  if (!/^\+[1-9][0-9]{7,14}$/.test(e164)) return '••••';
  const digits = e164.slice(1);
  const tail = digits.slice(-2);
  if (digits.startsWith('62')) return `+62 ${digits.slice(2, 5)}••••${tail}`;
  return `+${digits.slice(0, 2)} ••••${tail}`;
}

/** Fitur menyala? Konfigurasi setengah jadi (EnvError) dianggap mati: halaman tetap tenang. */
export function waEnabled(): { botNumber: string | null } | null {
  try {
    const env = readWaEnv();
    return env === null ? null : { botNumber: env.botNumber };
  } catch {
    return null;
  }
}

export async function loadWaLink(ctx: WaCtx): Promise<WaLinkStatus> {
  const enabled = waEnabled();
  if (enabled === null) return { state: 'off' };
  const phone = await withUser(ctx.pools.app, ctx.userId, async (client) => {
    const r = await client.query<{ phone_e164: string }>('select phone_e164 from app.wa_links');
    return r.rows[0]?.phone_e164 ?? null;
  });
  return phone === null
    ? { state: 'unlinked', botNumber: enabled.botNumber }
    : { state: 'linked', masked: maskPhone(phone), botNumber: enabled.botNumber };
}

const codeResult = z.object({
  code: z.string().regex(/^[A-Z0-9]{6}$/),
  expires_at: z.string().min(1),
});

export interface WaLinkCode {
  code: string;
  expiresAt: string;
}

export class WaDisabledError extends Error {
  constructor() {
    super('wa_disabled');
    this.name = 'WaDisabledError';
  }
}

export async function createWaLinkCode(ctx: WaCtx): Promise<WaLinkCode> {
  if (waEnabled() === null) throw new WaDisabledError();
  const raw = await withUser(ctx.pools.app, ctx.userId, async (client) => {
    const r = await client.query<{ r: unknown }>('select api.wa_create_link_code() as r');
    return r.rows[0]?.r;
  });
  const parsed = codeResult.parse(raw);
  return { code: parsed.code, expiresAt: new Date(parsed.expires_at).toISOString() };
}

export async function unlinkWa(ctx: WaCtx): Promise<void> {
  await withUser(ctx.pools.app, ctx.userId, async (client) => {
    await client.query('select api.wa_unlink()');
  });
}
