import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withAnon } from '../../db';
import {
  createLedgerHarness,
  resetLedger,
  seedPersonas,
  type Persona,
} from '../../ledger/__int__/harness';
import { createWaLinkCode, loadWaLink, unlinkWa, type WaCtx } from '../link';

/**
 * Halaman WhatsApp terhadap Postgres sungguhan: baris milik sendiri saja (RLS), kode hubung
 * dibuat atas nama sesi, putus tidak menyentuh tautan user lain. Fitur dinyalakan lewat env.
 */

const h = createLedgerHarness();
afterAll(async () => {
  await h.close();
});

const N_PHONE = '+6281234567890';
const F_PHONE = '+6285711112222';

let n: Persona;
let f: Persona;

const ctxOf = (p: Persona): WaCtx => ({ pools: h.pools, userId: p.id });

async function link(p: Persona, phone: string) {
  const { code } = await createWaLinkCode(ctxOf(p));
  const uid = await withAnon(h.pools.app, async (c) => {
    const { rows } = await c.query<{ r: string | null }>(
      'select api.wa_confirm_link($1, $2) as r',
      [code, phone],
    );
    return rows[0]?.r ?? null;
  });
  expect(uid).toBe(p.id);
}

beforeEach(async () => {
  vi.stubEnv('WA_WEBHOOK_SECRET', 'rahasia-webhook-1234');
  vi.stubEnv('OPENWA_URL', 'http://127.0.0.1:2785');
  vi.stubEnv('OPENWA_API_KEY', 'kunci');
  vi.stubEnv('OPENWA_SESSION', 'sesi');
  vi.stubEnv('WA_BOT_NUMBER', '+62 811 0000 111');
  await resetLedger(h);
  const personas = await seedPersonas(h, { farida: 'bergabung' });
  n = personas.n;
  if (!personas.f) throw new Error('farida tidak ada');
  f = personas.f;
});

describe('halaman WhatsApp (DB sungguhan)', () => {
  it('createWaLinkCode: kode 6 karakter atas nama sesi, berlaku sekitar 10 menit', async () => {
    const r = await createWaLinkCode(ctxOf(n));
    expect(r.code).toMatch(/^[A-Z0-9]{6}$/);
    const ms = new Date(r.expiresAt).getTime() - Date.now();
    expect(ms).toBeGreaterThan(9 * 60_000);
    expect(ms).toBeLessThanOrEqual(10 * 60_000 + 5000);
    const { rows } = await h.admin.query('select user_id from app.wa_link_codes');
    expect(rows).toEqual([{ user_id: n.id }]);
  });

  it('loadWaLink: belum terhubung, lalu terhubung dengan nomor tersamar', async () => {
    expect(await loadWaLink(ctxOf(n))).toEqual({
      state: 'unlinked',
      botNumber: '628110000111',
    });
    await link(n, N_PHONE);
    const s = await loadWaLink(ctxOf(n));
    expect(s).toEqual({ state: 'linked', masked: '+62 812••••90', botNumber: '628110000111' });
    expect(JSON.stringify(s)).not.toContain('81234567890');
  });

  it('loadWaLink: tidak pernah melihat nomor user lain', async () => {
    await link(n, N_PHONE);
    expect((await loadWaLink(ctxOf(f))).state).toBe('unlinked');
  });

  it('unlinkWa: hanya baris sendiri; tautan user lain tetap', async () => {
    await link(n, N_PHONE);
    await link(f, F_PHONE);
    await unlinkWa(ctxOf(n));
    const { rows } = await h.admin.query<{ user_id: string; phone_e164: string }>(
      'select user_id, phone_e164 from app.wa_links',
    );
    expect(rows).toEqual([{ user_id: f.id, phone_e164: F_PHONE }]);
    expect((await loadWaLink(ctxOf(n))).state).toBe('unlinked');
    expect((await loadWaLink(ctxOf(f))).state).toBe('linked');
  });

  it('unlinkWa tanpa tautan: tidak galat dan tidak menyentuh siapa pun', async () => {
    await link(f, F_PHONE);
    await unlinkWa(ctxOf(n));
    const { rows } = await h.admin.query('select user_id from app.wa_links');
    expect(rows).toEqual([{ user_id: f.id }]);
  });

  it('fitur mati: loadWaLink = off dan kode tidak dibuat', async () => {
    for (const k of [
      'WA_WEBHOOK_SECRET',
      'OPENWA_URL',
      'OPENWA_API_KEY',
      'OPENWA_SESSION',
      'WA_BOT_NUMBER',
    ])
      vi.stubEnv(k, '');
    expect(await loadWaLink(ctxOf(n))).toEqual({ state: 'off' });
    await expect(createWaLinkCode(ctxOf(n))).rejects.toThrow('wa_disabled');
    const { rows } = await h.admin.query('select 1 from app.wa_link_codes');
    expect(rows).toHaveLength(0);
  });
});
