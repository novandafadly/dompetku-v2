export interface InboundMessage {
  messageId: string;
  /** ID pengirim mentah dari OpenWA (sufiks @c.us / @lid dipertahankan). */
  from: string;
  chatType: 'private' | 'group' | 'other';
  fromMe: boolean;
  /** null = bukan pesan teks. */
  text: string | null;
  /** data.senderPhone OpenWA (opt-in RESOLVE_LID_TO_PHONE=true), digit apa adanya; null bila tidak ada. */
  senderPhone: string | null;
  /** data.timestamp OpenWA (detik epoch waktu pesan); null bila tidak ada atau tidak sah. */
  sentAt: number | null;
}

export interface WaTransport {
  /**
   * HMAC waktu-tetap atas body mentah. Route wajib membaca `await req.arrayBuffer()` dan
   * mengoper byte (bukan `req.text()`, yang membuang BOM dan mengganti byte tidak valid).
   */
  verify(rawBody: string | Uint8Array, headers: Headers): boolean;
  /** null = bukan event pesan masuk. */
  toInbound(rawBody: string | Uint8Array): InboundMessage | null;
  sendText(toPhoneE164: string, text: string): Promise<void>;
}
