// Parser pesan Catat WhatsApp (spec 4.1). Murni: tanpa I/O.

/**
 * Tanggal dari teks, belum dipadukan dengan hari ini (parser murni; `resolveDate` di `date.ts`
 * memakai `app.today()` dari DB). `full` sudah divalidasi kalender.
 */
export type DateSpec =
  | { kind: 'ago'; days: number }
  | { kind: 'day'; day: number }
  | { kind: 'dm'; day: number; month: number }
  | { kind: 'full'; year: number; month: number; day: number };

export type ParseResult =
  | {
      kind: 'entry';
      type: 'income' | 'expense';
      amount: number;
      space: 'personal' | 'shared';
      description: string;
      /** Penanda `@nama` (huruf kecil, tanpa `@`); kunci tidak ada bila pesan tanpa penanda. */
      wallet?: string;
      /** Penanda tanggal (kemarin, tgl ...); kunci tidak ada bila pesan tanpa tanggal. */
      date?: DateSpec;
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
        | 'bad_wallet'
        | 'many_dates'
        | 'bad_date';
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
// Tanggal (spec 4.1): `kemarin`/`kmrn`/`kemaren`, `tgl|tanggal` + (D | D/M | D-M | D/M/YYYY | D-M-YY |
// YYYY-MM-DD | D <nama bulan>), dan ISO telanjang (2026-11-09). Bentuk angka tanpa `tgl` bukan
// tanggal ("1/2 porsi"). Token lebih dari 20 karakter tidak mungkin tanggal dan tidak disentuh regex.
const DATE_TOKEN_MAX = 20;
const DATE_TRAIL_RE = /[.,;:!?]+$/;
const AGO_WORDS = new Set(['kemarin', 'kmrn', 'kemaren']);
const DATE_KEYWORDS = new Set(['tgl', 'tanggal']);
const ISO_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DMY_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/;
const DM_RE = /^(\d{1,2})[/-](\d{1,2})$/;
const D_RE = /^\d{1,2}$/;
const MONTHS: Record<string, number> = {
  jan: 1,
  januari: 1,
  feb: 2,
  februari: 2,
  mar: 3,
  maret: 3,
  apr: 4,
  april: 4,
  mei: 5,
  jun: 6,
  juni: 6,
  jul: 7,
  juli: 7,
  agu: 8,
  agt: 8,
  ags: 8,
  agustus: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  des: 12,
  desember: 12,
};
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

function dateToken(raw: string | undefined): string | null {
  if (raw === undefined || raw.length > DATE_TOKEN_MAX) return null;
  return raw.replace(DATE_TRAIL_RE, '');
}

/** Hari valid untuk bulan itu; Februari boleh 29 (tahun belum diketahui). */
function validDayMonth(day: number, month: number): boolean {
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(2024, month, 0)).getUTCDate()
  );
}

function fullDate(year: number, month: number, day: number): DateSpec | null {
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return { kind: 'full', year, month, day };
}

function readIso(t: string): DateSpec | null {
  const m = ISO_DATE_RE.exec(t);
  return m ? fullDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** Tanggal sesudah `tgl`/`tanggal` mulai di `words[j]`; `used` = jumlah token yang dipakai. */
function readDate(words: readonly string[], j: number): { spec: DateSpec; used: number } | null {
  const t = dateToken(words[j]);
  if (t === null) return null;
  const iso = readIso(t);
  if (iso) return { spec: iso, used: 1 };
  const dmy = DMY_RE.exec(t);
  if (dmy) {
    const y = dmy[3] ?? '';
    const spec = fullDate(
      y.length === 2 ? 2000 + Number(y) : Number(y),
      Number(dmy[2]),
      Number(dmy[1]),
    );
    return spec ? { spec, used: 1 } : null;
  }
  const dm = DM_RE.exec(t);
  if (dm) {
    const [day, month] = [Number(dm[1]), Number(dm[2])];
    return validDayMonth(day, month) ? { spec: { kind: 'dm', day, month }, used: 1 } : null;
  }
  if (!D_RE.test(t)) return null;
  const day = Number(t);
  if (day < 1 || day > 31) return null;
  const month = MONTHS[dateToken(words[j + 1]) ?? ''];
  if (month !== undefined) {
    return validDayMonth(day, month) ? { spec: { kind: 'dm', day, month }, used: 2 } : null;
  }
  return { spec: { kind: 'day', day }, used: 1 };
}

/** Ambil penanda tanggal dari aliran kata; sisa kata dikembalikan (tanggal tidak jadi keterangan). */
function extractDate(words: readonly string[]): {
  rest: string[];
  date?: DateSpec;
  count: number;
  bad: boolean;
} {
  const rest: string[] = [];
  let date: DateSpec | undefined;
  let count = 0;
  let bad = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? '';
    const t = dateToken(w);
    if (t !== null && AGO_WORDS.has(t)) {
      count += 1;
      date = { kind: 'ago', days: 1 };
    } else if (t !== null && readIso(t)) {
      count += 1;
      date = readIso(t) ?? undefined;
    } else if (t !== null && DATE_KEYWORDS.has(t)) {
      count += 1;
      const r = readDate(words, i + 1);
      if (r) {
        date = r.spec;
        i += r.used;
      } else {
        bad = true;
        i += 1; // buang token sesudah `tgl` agar tidak terbaca sebagai nominal
      }
    } else {
      rest.push(w);
    }
  }
  return date === undefined ? { rest, count, bad } : { rest, date, count, bad };
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

  // Tanggal diambil sesudah penanda dompet dan sebelum nominal: angkanya tidak boleh terbaca nominal.
  const ex = extractDate(words);
  if (ex.count > 1) return { kind: 'reject', reason: 'many_dates' };
  if (ex.bad) return { kind: 'reject', reason: 'bad_date' };

  // "rp 25.000" / "rp. 25.000": gabungkan penanda mata uang dengan token angka berikutnya.
  // "25 rb" / "1,5 jt" / "25 ribu": gabungkan satuan dengan token angka sebelumnya, sehingga
  // nominal tidak terbaca 1000x lebih kecil. Token yang hanya diawali satuan ("25 rbu",
  // "25 rb,", "50 k.", "25 ｒｂ") ikut digabung apa adanya agar ditolak (bad_amount), sama
  // dengan "25rbu": gagal tertutup.
  const tokens: string[] = [];
  for (const t of ex.rest) {
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
    ...(ex.date === undefined ? {} : { date: ex.date }),
  };
}
