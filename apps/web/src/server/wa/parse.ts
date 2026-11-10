// Parser pesan Catat WhatsApp (spec 4.1). Murni: tanpa I/O.

export type ParseResult =
  | {
      kind: 'entry';
      type: 'income' | 'expense';
      amount: number;
      space: 'personal' | 'shared';
      description: string;
    }
  | { kind: 'cancel' }
  | { kind: 'link'; code: string }
  | {
      kind: 'reject';
      reason: 'empty' | 'no_amount' | 'many_amounts' | 'bad_amount' | 'too_large';
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
// Kata yang diawali satuan tapi bukan satuan ("rbu", "jutaan"): digabung lalu ditolak.
const UNIT_TYPO_RE = /^(?:rb|jt|rib|jut)\p{L}+$/u;
const UNIT_ALIAS: Partial<Record<string, string>> = { ribu: 'rb', juta: 'jt' };

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

  // "rp 25.000" / "rp. 25.000": gabungkan penanda mata uang dengan token angka berikutnya.
  // "25 rb" / "1,5 jt" / "25 ribu": gabungkan satuan dengan token angka sebelumnya, sehingga
  // nominal tidak terbaca 1000x lebih kecil. Salah ketik satuan ("25 rbu") ikut digabung agar
  // ditolak (bad_amount), sama dengan "25rbu".
  const tokens: string[] = [];
  for (const t of norm.split(' ')) {
    const prev = tokens[tokens.length - 1];
    if ((prev === 'rp' || prev === 'rp.') && ANY_DIGIT_RE.test(t))
      tokens[tokens.length - 1] = prev + t;
    else if (
      prev !== undefined &&
      AMOUNT_TOKEN_RE.test(prev) &&
      (UNIT_WORD_RE.test(t) || UNIT_TYPO_RE.test(t))
    )
      tokens[tokens.length - 1] = prev + (UNIT_ALIAS[t] ?? t);
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

  return {
    kind: 'entry',
    type: income ? 'income' : 'expense',
    amount,
    space: shared || sharedWord ? 'shared' : 'personal',
    description: rest.join(' ').slice(0, MAX_DESCRIPTION).trimEnd(),
  };
}
