/**
 * Header keamanan (TRD §3.4, Spec §9.2). Header statis dipasang next.config untuk semua respons;
 * CSP bernonce dibuat per request oleh src/proxy.ts.
 */

/** HSTS tanpa preload/includeSubDomains: domain induk dipakai app lain (edge nginx juga mengirim ini). */
export const HSTS = 'max-age=31536000';

export const staticSecurityHeaders: readonly { key: string; value: string }[] = [
  { key: 'Strict-Transport-Security', value: HSTS },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/**
 * CSP penuh TRD §3.4 dengan dua tambahan:
 * - `style-src-attr 'unsafe-inline'`: atribut `style` hasil SSR (lebar bar anggaran, porsi
 *   grafik) tidak bisa diberi nonce. Elemen `<style>` tetap wajib nonce.
 * - `font-src`/`manifest-src 'self'`: eksplisit, sama dengan default-src.
 * Mode dev (next dev) butuh `unsafe-eval` (React) dan style inline tanpa nonce (HMR).
 */
export function contentSecurityPolicy(nonce: string, dev = false): string {
  const directives = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "connect-src 'self'",
    "worker-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "manifest-src 'self'",
  ];
  return directives.join('; ');
}

/**
 * Kebijakan minimum yang selalu ditegakkan, juga saat CSP penuh masih report-only
 * (TRD: report-only satu minggu di M0b), supaya anti-framing dan base-uri tidak ikut longgar.
 */
export const ENFORCED_BASELINE_CSP = "frame-ancestors 'none'; object-src 'none'; base-uri 'none'";

/** Nonce 128-bit acak, base64. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Skrip inline kepala: menyalin nonce ke `__webpack_nonce__` agar `<style>` yang disisipkan
 * library saat runtime (react-remove-scroll lewat get-nonce, dipakai Radix Dialog) ikut bernonce.
 * Nonce memang sudah terbaca oleh skrip halaman lewat `script.nonce`; ini tidak menambah paparan.
 */
export const styleNonceBootScript =
  'try{window.__webpack_nonce__=document.currentScript.nonce}catch(e){}';
