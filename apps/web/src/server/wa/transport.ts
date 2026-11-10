export interface InboundMessage {
  messageId: string;
  /** ID pengirim mentah dari OpenWA (sufiks @c.us / @lid dipertahankan). */
  from: string;
  chatType: 'private' | 'group' | 'other';
  fromMe: boolean;
  /** null = bukan pesan teks. */
  text: string | null;
}

export interface WaTransport {
  /** HMAC waktu-tetap atas body mentah. */
  verify(rawBody: string, headers: Headers): boolean;
  /** null = bukan event pesan masuk. */
  toInbound(rawBody: string): InboundMessage | null;
  sendText(toPhoneE164: string, text: string): Promise<void>;
}
