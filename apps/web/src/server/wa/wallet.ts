// Pencocokan penanda `@nama` ke dompet aktif satu ruang (spec 4.4). Murni: tanpa I/O.

export interface WalletOption {
  id: string;
  name: string;
  pocket: 'operasional' | 'tabungan' | 'kantor';
}

export type WalletMatch =
  | { kind: 'found'; wallet: WalletOption }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: WalletOption[] };

const COMBINING_RE = /\p{M}/gu;
const NON_ALNUM_RE = /[^\p{L}\p{N}]+/gu;

/** NFKC, huruf kecil, tanpa diakritik dan tanpa semua yang bukan huruf/angka ("BCA (utama)" = "bcautama"). */
function key(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_RE, '')
    .replace(NON_ALNUM_RE, '');
}

function words(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_RE, '')
    .split(NON_ALNUM_RE)
    .filter((w) => w !== '');
}

/**
 * Pencocokan bertingkat, hanya terhadap `accounts` (dompet aktif ruang tujuan); tingkat pertama yang
 * punya kecocokan menentukan, dan harus tepat satu, kalau tidak `ambiguous`:
 * 1. nama persis (tanpa huruf besar/kecil, spasi, tanda baca: `@kas-kantor` = "Kas Kantor");
 * 2. awalan nama (`@cim` = "CIMB");
 * 3. awalan salah satu kata nama atau nama kantong (`@kantor` = "Kas Kantor"; `@tabungan`).
 * Nama persis menang atas awalan, jadi `@bca` tetap memilih "BCA" walau ada "BCA Syariah".
 */
export function matchWallet(marker: string, accounts: readonly WalletOption[]): WalletMatch {
  const mk = key(marker);
  if (mk === '') return { kind: 'none' };
  // Penanda 1 huruf hanya boleh nama persis: awalan/kata sependek itu terlalu mudah memilih dompet
  // "unik" yang tidak dimaksud (`@t`, `@k`, `@o`).
  const tiers: ((a: WalletOption) => boolean)[] = [
    (a) => key(a.name) === mk,
    ...(mk.length < 2
      ? []
      : [
          (a: WalletOption) => key(a.name).startsWith(mk),
          (a: WalletOption) =>
            words(a.name).some((w) => w.startsWith(mk)) || a.pocket.startsWith(mk),
        ]),
  ];
  for (const test of tiers) {
    const hit = accounts.filter(test);
    if (hit.length === 1 && hit[0]) return { kind: 'found', wallet: hit[0] };
    if (hit.length > 1) return { kind: 'ambiguous', candidates: hit };
  }
  return { kind: 'none' };
}

/** Penanda siap ketik untuk sebuah dompet ("Kas Kantor" → `@kas-kantor`); null bila tak bisa dibentuk. */
export function walletHandle(name: string): string | null {
  const h = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(NON_ALNUM_RE, '-')
    .replace(/^-+|-+$/g, '');
  return h === '' ? null : `@${h}`;
}
