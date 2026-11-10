// Parser pesan Catat WhatsApp (spec 4.1). Murni: tanpa I/O.

export type ParseResult =
  | {
      kind: 'entry';
      type: 'income' | 'expense';
      amount: number;
      space: 'personal' | 'shared';
      description: string;
      /** Penanda `@nama` (huruf kecil, tanpa `@`); kunci tidak ada bila pesan tanpa penanda. */
      wallet?: string;
    }
  | { kind: 'cancel' }
  | { kind: 'link'; code: string }
  | {
      kind: 'reject';
      reason:
        | 'empty'
        | 'no_amount'
        | 'many_amounts'
        | 'bad_amount'
        | 'too_large'
        | 'many_wallets'
        | 'bad_wallet';
    };

const MAX_DESCRIPTION = 200;
const INCOME_WORDS = new Set(['gaji', 'masuk', 'terima', 'pemasukan']);
const LINK_RE = /^hubung\s+([a-z0-9]{6})$/;
const ANY_DIGIT_RE = /\p{Nd}/u;
// Angka bulat, atau ribuan bertitik (25.000, 1.250.000).
const PLAIN_RE = /^(\d+|\d{1,3}(?:\.\d{3})+)$/;
// Dengan sufiks: satu digit pecahan saja (1,5jt), sehingga hasil selalu bulat.
const SUFFIX_RE = /^(\d+)(?:[.,](\d))?(rb|k|jt)$/;
// Token angka tanpa satuan (boleh diawali + dan/atau rp): bulat, ribuan bertitik, atau satu
// digit pecahan. Hanya token ini yang boleh menerima satuan terpisah.
const AMOUNT_TOKEN_RE = /^\+?(?:rp\.?)?(?:\d+|\d{1,3}(?:\.\d{3})+|\d+[.,]\d)$/;
const UNIT_WORD_RE = /^(?:rb|k|jt|ribu|juta)$/;
// Token yang DIAWALI satuan (dicek pada unitKey): `rb`/`jt`/`rib`/`jut`, slang `reb` (rebu,
// rebuan), `ewu`, `miliar`/`milyar`/`triliun`/`trilyun` dengan apa pun sesudahnya, atau
// `k`/`m`/`mil` (miliar) yang tidak diikuti huruf (`3 milo` tetap keterangan).
// Token seperti ini digabung ke angka di depannya; bila bukan satuan persis ("rb,", "k.",
// "rb-an", "ｒｂ", "rbu", "rebu", "2 m", "рб") hasil gabungan gagal di SUFFIX_RE sehingga
// ditolak (bad_amount), tidak dibaca 1000x lebih kecil. `kopi`/`ke`/`mie` (k/m + huruf) tetap
// keterangan. Kata keterangan yang kebetulan diawali `rib`/`jut`/`reb`/`ewu` tepat sesudah angka
// tanpa satuan ("2 rebus") ikut ditolak: gagal tertutup, pengguna menulis ulang.
const UNIT_START_RE =
  /^(?:rb|jt|rib|jut|reb|ewu|miliar|milyar|triliun|trilyun|mil(?!\p{L})|k(?!\p{L})|m(?!\p{L}))/u;
// Penanda dompet: token yang diawali `@`. Tanda baca penutup kalimat dibuang (`@cimb.`); sisanya
// harus huruf/angka/`_`/`-`, kalau tidak = bad_wallet (gagal tertutup: dompet tidak ditebak). `@`
// sendirian dan `@` di tengah token (email) bukan penanda dan tetap keterangan.
// Nama dompet maksimum 60 karakter (`app.accounts.name`): penanda lebih panjang tidak mungkin
// cocok dan ditolak sebelum regex apa pun menyentuhnya (pesan sampai 64 KiB).
const WALLET_MAX = 60;
const WALLET_TRAIL_RE = /[.,;:!?]+$/;
const WALLET_RE = /^[\p{L}\p{N}_-]+$/u;
const FORMAT_CHARS_RE = /\p{Cf}/gu;
const COMBINING_RE = /\p{M}/gu;
// Huruf Kiril/Yunani yang mirip atau sebunyi dengan huruf satuan, hanya untuk unitKey (keterangan
// tidak diubah). в -> w agar `еву` = `ewu`.
const CONFUSABLE: Partial<Record<string, string>> = {
  р: 'r',
  б: 'b',
  к: 'k',
  м: 'm',
  е: 'e',
  в: 'w',
  и: 'i',
  у: 'u',
  т: 't',
  ј: 'j',
  κ: 'k',
  μ: 'm',
  ρ: 'r',
  ε: 'e',
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLE).join('')}]`, 'gu');
const UNIT_ALIAS: Partial<Record<string, string>> = { ribu: 'rb', juta: 'jt' };

/** NFKC, huruf kecil, tanpa karakter format tak terlihat dan tanda diakritik, huruf mirip -> Latin. */
function unitKey(token: string): string {
  return token
    .normalize('NFKC')
    .toLowerCase()
    .replace(FORMAT_CHARS_RE, '')
    .normalize('NFD')
    .replace(COMBINING_RE, '')
    .replace(CONFUSABLE_RE, (c) => CONFUSABLE[c] ?? c);
}

function startsWithUnit(token: string): boolean {
  return UNIT_START_RE.test(unitKey(token));
}

function toAmount(raw: string): number | null {
  const plain = PLAIN_RE.exec(raw);
  if (plain) return Number((plain[1] ?? '').replace(/\./g, ''));
  const suf = SUFFIX_RE.exec(raw);
  if (suf) {
    const unit = suf[3] === 'jt' ? 1_000_000 : 1000;
    const whole = Number(suf[1]) * unit;
    const frac = suf[2] ? (Number(suf[2]) * unit) / 10 : 0;
    return whole + frac;
  }
  return null;
}

export function parseMessage(text: string, opts: { maxAmount: number }): ParseResult {
  const norm = text.toLowerCase().trim().replace(/\s+/g, ' ');
  if (norm === '') return { kind: 'reject', reason: 'empty' };
  if (norm === 'batal') return { kind: 'cancel' };
  const link = LINK_RE.exec(norm);
  if (link) return { kind: 'link', code: (link[1] ?? '').toUpperCase() };

  // Penanda @nama diambil lebih dulu dan dibuang dari aliran token, sehingga tidak dibaca sebagai
  // nominal (`@bca2`) dan tidak memutus gabungan angka + satuan (`23 @cimb rb` = 23rb).
  let wallet: string | undefined;
  let walletCount = 0;
  let walletBad = false;
  const words: string[] = [];
  for (const t of norm.split(' ')) {
    if (t.length > 1 && t.startsWith('@')) {
      walletCount += 1;
      const name = t.length > WALLET_MAX + 1 ? '' : t.slice(1).replace(WALLET_TRAIL_RE, '');
      if (WALLET_RE.test(name)) wallet = name;
      else walletBad = true;
    } else {
      words.push(t);
    }
  }

  // "rp 25.000" / "rp. 25.000": gabungkan penanda mata uang dengan token angka berikutnya.
  // "25 rb" / "1,5 jt" / "25 ribu": gabungkan satuan dengan token angka sebelumnya, sehingga
  // nominal tidak terbaca 1000x lebih kecil. Token yang hanya diawali satuan ("25 rbu",
  // "25 rb,", "50 k.", "25 ｒｂ") ikut digabung apa adanya agar ditolak (bad_amount), sama
  // dengan "25rbu": gagal tertutup.
  const tokens: string[] = [];
  for (const t of words) {
    const prev = tokens[tokens.length - 1];
    if ((prev === 'rp' || prev === 'rp.') && ANY_DIGIT_RE.test(t))
      tokens[tokens.length - 1] = prev + t;
    else if (prev !== undefined && AMOUNT_TOKEN_RE.test(prev) && startsWithUnit(t))
      tokens[tokens.length - 1] = prev + (UNIT_WORD_RE.test(t) ? (UNIT_ALIAS[t] ?? t) : t);
    else tokens.push(t);
  }

  const shared = tokens[0] === 'b';
  let income = false;
  let sharedWord = false;
  let amountRaw = '';
  let amountCount = 0;
  const rest: string[] = [];

  for (const [i, tok] of tokens.entries()) {
    if (i === 0 && shared) continue;
    if (tok === 'bersama') {
      sharedWord = true;
      continue;
    }
    if (tok === '+') {
      income = true;
      continue;
    }
    if (INCOME_WORDS.has(tok)) {
      income = true;
      rest.push(tok);
      continue;
    }
    if (ANY_DIGIT_RE.test(tok)) {
      amountCount += 1;
      let body = tok;
      if (body.startsWith('+')) {
        income = true;
        body = body.slice(1);
      }
      amountRaw = body.replace(/^rp\.?/, '');
      continue;
    }
    rest.push(tok);
  }

  if (amountCount === 0) return { kind: 'reject', reason: 'no_amount' };
  if (amountCount > 1) return { kind: 'reject', reason: 'many_amounts' };

  const amount = toAmount(amountRaw);
  if (amount === null || !Number.isSafeInteger(amount) || amount <= 0) {
    return { kind: 'reject', reason: 'bad_amount' };
  }
  if (amount > opts.maxAmount) return { kind: 'reject', reason: 'too_large' };
  if (walletCount > 1) return { kind: 'reject', reason: 'many_wallets' };
  if (walletBad) return { kind: 'reject', reason: 'bad_wallet' };

  return {
    kind: 'entry',
    type: income ? 'income' : 'expense',
    amount,
    space: shared || sharedWord ? 'shared' : 'personal',
    description: rest.join(' ').slice(0, MAX_DESCRIPTION).trimEnd(),
    ...(wallet === undefined ? {} : { wallet }),
  };
}
