import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WaEnv } from './config';
import type { InboundMessage, WaTransport } from './transport';

const SIGNATURE_HEADER = 'x-openwa-signature'; // "sha256=<hex>" atas body mentah (docs/06 §6.6)

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function createOpenWaTransport(env: WaEnv, fetchImpl: typeof fetch = fetch): WaTransport {
  return {
    verify(rawBody, headers) {
      const header = headers.get(SIGNATURE_HEADER);
      if (!header) return false;
      const expected = `sha256=${createHmac('sha256', env.webhookSecret).update(rawBody).digest('hex')}`;
      const a = Buffer.from(header);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    },

    toInbound(rawBody) {
      let json: unknown;
      try {
        const text =
          typeof rawBody === 'string' ? rawBody : new TextDecoder('utf-8').decode(rawBody);
        json = JSON.parse(text);
      } catch {
        return null;
      }
      if (!isRecord(json) || json.event !== 'message.received' || !isRecord(json.data)) return null;
      const d = json.data;
      if (typeof d.id !== 'string' || !d.id || typeof d.from !== 'string' || !d.from) return null;
      // Pertahanan sendiri: 'private' hanya untuk pengirim @c.us / @lid, apa pun arti `kind`/`isGroup`.
      // UNVERIFIED: `kind` dan `isGroup` dari dokumen, belum diuji pada sesi hidup.
      const privateSender = /^[^@\s]+@(c\.us|lid)$/.test(d.from);
      const chatType: InboundMessage['chatType'] =
        d.isGroup === true || d.kind === 'group' || d.from.endsWith('@g.us')
          ? 'group'
          : privateSender && d.kind === 'individual' && d.isGroup === false
            ? 'private'
            : 'other';
      return {
        messageId: d.id,
        from: d.from,
        chatType,
        fromMe: d.fromMe === true,
        text: d.type === 'text' && typeof d.body === 'string' ? d.body : null,
        // Opt-in (RESOLVE_LID_TO_PHONE=true): digit MSISDN apa adanya; normalisasi E.164 di Task 4.
        senderPhone: typeof d.senderPhone === 'string' && d.senderPhone ? d.senderPhone : null,
      };
    },

    async sendText(toPhoneE164, text) {
      const digits = toPhoneE164.replace(/\D/g, '');
      let res: Response;
      try {
        res = await fetchImpl(
          `${env.openwaUrl}/api/sessions/${encodeURIComponent(env.session)}/messages/send-text`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': env.apiKey },
            body: JSON.stringify({ chatId: `${digits}@c.us`, text }),
            signal: AbortSignal.timeout(10_000),
          },
        );
      } catch {
        throw new Error('OpenWA sendText gagal: tidak terhubung');
      }
      if (!res.ok) throw new Error(`OpenWA sendText gagal: status ${String(res.status)}`);
    },
  };
}
