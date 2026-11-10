import { createPools } from '@/server/db';
import { readServerEnv } from '@/server/env';
import { createLogThrottle, readBodyCapped } from '@/server/wa/body';
import { readWaEnv } from '@/server/wa/config';
import { createWaDeps, handleInbound, type WaDeps } from '@/server/wa/handle';
import { createOpenWaTransport } from '@/server/wa/openwa';

/**
 * Webhook OpenWA (spec 2026-11-09 §5.2, §6). Urutan: fitur mati 404, batas ukuran 413,
 * HMAC atas byte mentah 401, baru parse. Body, pengirim, dan tanda tangan tidak pernah dicatat.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };

/** Satu instance per proses (pool + batas laju dalam memori), dibuat saat request pertama. */
let deps: WaDeps | undefined;

/**
 * `config_error` terjadi sebelum verifikasi tanda tangan, jadi POST tanpa autentikasi bisa
 * memicunya: paling banyak satu baris log per 60 detik per proses.
 */
const configErrorLog = createLogThrottle(60_000);

function reply(status: number, body: Record<string, unknown> = {}): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Pesan sah tapi bukan untuk Catat: 200 dan satu baris log berisi alasan mesin saja (tanpa body,
 * pengirim, teks, atau id), agar bentuk payload OpenWA yang berubah terlihat di log.
 */
function ignored(reason: 'not_message' | 'not_private' | 'from_me' | 'not_text'): Response {
  console.warn(`[wa] ignored ${reason}`);
  return reply(200, { ok: true });
}

function getDeps(): WaDeps | null {
  if (deps) return deps;
  const env = readWaEnv();
  if (!env) return null;
  deps = createWaDeps(createPools(readServerEnv().databaseUrl), createOpenWaTransport(env), env);
  return deps;
}

export async function POST(req: Request): Promise<Response> {
  let d: WaDeps | null;
  try {
    d = getDeps();
  } catch {
    if (configErrorLog.allow()) console.warn('[wa] config_error');
    return reply(503, { ok: false });
  }
  if (!d) return reply(404);

  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return reply(413);
  const bytes = await readBodyCapped(req, MAX_BODY_BYTES);
  if (bytes === 'too_large') return reply(413);

  if (!d.transport.verify(bytes, req.headers)) return reply(401);

  const msg = d.transport.toInbound(bytes);
  if (msg === null) return ignored('not_message');
  if (msg.chatType !== 'private') return ignored('not_private');
  if (msg.fromMe) return ignored('from_me');
  if (msg.text === null) return ignored('not_text');
  try {
    await handleInbound(d, msg);
  } catch {
    console.warn('[wa] handler_error');
  }
  return reply(200, { ok: true });
}
