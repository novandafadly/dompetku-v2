'use client';

/**
 * WebAuthn di peramban. @simplewebauthn/browser dimuat saat tombol ditekan (bukan bagian JS rute
 * awal, ADR 0002). Galat dibedakan: dibatalkan/tidak didukung vs ditolak server.
 */
export type PasskeyFailure = 'unsupported' | 'cancelled';

export async function getAssertion(options: unknown) {
  const lib = await import('@simplewebauthn/browser');
  if (!lib.browserSupportsWebAuthn()) return { error: 'unsupported' as const };
  try {
    const response = await lib.startAuthentication({
      optionsJSON: options as Parameters<typeof lib.startAuthentication>[0]['optionsJSON'],
    });
    return { response };
  } catch {
    return { error: 'cancelled' as const };
  }
}

export async function createCredential(options: unknown) {
  const lib = await import('@simplewebauthn/browser');
  if (!lib.browserSupportsWebAuthn()) return { error: 'unsupported' as const };
  try {
    const response = await lib.startRegistration({
      optionsJSON: options as Parameters<typeof lib.startRegistration>[0]['optionsJSON'],
    });
    return { response };
  } catch {
    return { error: 'cancelled' as const };
  }
}
