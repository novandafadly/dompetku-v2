import 'server-only';
import type { IsoDate } from '@dompetku/domain';
import { resolveDate } from '@/server/wa/date';
import { parseMessage, type DateSpec } from '@/server/wa/parse';
import { matchWallet, type WalletOption } from '@/server/wa/wallet';
import { MAX_FREE_TEXT_LENGTH, MAX_LLM_AMOUNT } from './provider';

/**
 * Parser aturan murni (tanpa I/O) untuk Catat teks bebas Bahasa Indonesia (S17).
 * Dibangun di atas `wa/parse.ts`, `wa/date.ts`, dan `wa/wallet.ts`, lalu diperluas untuk
 * kalimat web alami tanpa `@` ("makan siang 35rb bca", "kopi 25k pakai gopay", "2 hari lalu")
 * serta pencocokan kategori aktif ruang aktif.
 *
 * Seluruh nominal tetap divalidasi sebagai integer aman > 0 (tidak ada kalkulasi saldo di TS).
 */

export interface RuleCategoryOption {
  id: string;
  name: string;
  type: 'income' | 'expense';
}

export interface RuleParseInput {
  text: string;
  today: IsoDate;
  wallets: readonly WalletOption[];
  categories: readonly RuleCategoryOption[];
  maxAmount?: number;
}

export interface RuleParsedEntry {
  type: 'income' | 'expense';
  amount: number;
  description: string;
  accountId: string | null;
  categoryId: string | null;
  occurredOn: IsoDate | null;
}

export type RuleRejectReason =
  | 'empty'
  | 'no_amount'
  | 'many_amounts'
  | 'bad_amount'
  | 'too_large'
  | 'future_date'
  | 'too_old_date'
  | 'bad_date';

export type RuleParseResult =
  | {
      ok: true;
      confidence: 'high' | 'low';
      entry: RuleParsedEntry;
    }
  | {
      ok: false;
      reason: RuleRejectReason;
      /** True jika pasti ditolak ledger (mis. masa depan / terlalu besar) — jangan panggil LLM. */
      hardReject: boolean;
    };

const BERSAMA_TOKEN = '__dkbersama__';
const FUTURE_WORD_RE = /(?<!kemarin\s)\b(?:besok|lusa)\b/iu;
const DAYS_AGO_RE = /\b(\d{1,3})\s*(?:hari(?:\s+yang)?|hr)\s+lalu\b/giu;
const TODAY_PHRASE_RE = /\bhari\s+ini\b/giu;
const WALLET_PREPOSITIONS = new Set([
  'pakai',
  'pake',
  'via',
  'dari',
  'lewat',
  'ke',
  'di',
  'dengan',
  'dg',
  'dgn',
  'dr',
]);
const EXTRA_INCOME_WORDS = new Set([
  'gajian',
  'bonus',
  'thr',
  'dapat',
  'dapet',
  'refund',
  'cashback',
  'dividen',
  'komisi',
  'honor',
  'penjualan',
  'hibah',
  'tunjangan',
  'insentif',
]);
const STRONG_EXPENSE_WORDS = new Set([
  'beli',
  'bayar',
  'belanja',
  'cicilan',
  'tagihan',
  'sewa',
  'isi',
  'topup',
  'top-up',
  'ongkir',
  'jajan',
]);
const STRONG_INCOME_WORDS = new Set([
  'gaji',
  'gajian',
  'thr',
  'pemasukan',
  'terima',
  'masuk',
  'dapat',
  'dapet',
  'refund',
  'cashback',
  'dividen',
]);

interface CategoryRule {
  type: 'expense' | 'income';
  keywords: readonly string[];
  catHints: readonly string[];
}

const CATEGORY_RULES: readonly CategoryRule[] = [
  {
    type: 'expense',
    keywords: [
      'makan',
      'makan siang',
      'makan malam',
      'sarapan',
      'kopi',
      'ngopi',
      'coffee',
      'minum',
      'minuman',
      'teh',
      'boba',
      'nasi',
      'bakso',
      'soto',
      'mie',
      'mi',
      'ayam',
      'sate',
      'warteg',
      'padang',
      'gofood',
      'grabfood',
      'shopeefood',
      'jajan',
      'snack',
      'cemilan',
      'roti',
      'kue',
      'cafe',
      'kafe',
      'resto',
      'restoran',
      'warung',
      'jus',
      'susu',
      'geprek',
      'rendang',
      'pecel',
      'bubur',
      'martabak',
      'pizza',
      'burger',
      'sushi',
      'ramen',
      'dimsum',
      'lunch',
      'dinner',
      'es',
    ],
    catHints: ['makan', 'minum', 'kuliner', 'konsumsi', 'pangan', 'makanan', 'food'],
  },
  {
    type: 'expense',
    keywords: [
      'ojol',
      'ojek',
      'gojek',
      'grab',
      'gocar',
      'grabcar',
      'goride',
      'bensin',
      'bbm',
      'pertalite',
      'pertamax',
      'shell',
      'spbu',
      'tol',
      'etoll',
      'e-toll',
      'parkir',
      'kereta',
      'krl',
      'commuter',
      'mrt',
      'lrt',
      'transjakarta',
      'busway',
      'bus',
      'angkot',
      'taksi',
      'taxi',
      'bluebird',
      'maxim',
      'indrive',
      'servis',
      'service',
      'oli',
      'tambal',
      'cuci motor',
      'cuci mobil',
      'transport',
      'transportasi',
      'tiket kereta',
      'tiket pesawat',
      'pesawat',
    ],
    catHints: ['transport', 'transportasi', 'kendaraan', 'perjalanan', 'mobilitas'],
  },
  {
    type: 'expense',
    keywords: [
      'listrik',
      'pln',
      'token',
      'token listrik',
      'air',
      'pdam',
      'wifi',
      'internet',
      'indihome',
      'biznet',
      'firstmedia',
      'pulsa',
      'kuota',
      'paket data',
      'telkomsel',
      'indosat',
      'xl',
      'smartfren',
      'tagihan',
      'iuran',
      'ipl',
      'sewa',
      'kos',
      'kost',
      'kontrakan',
      'bpjs',
      'asuransi',
      'cicilan',
      'pajak',
      'pbb',
      'stnk',
      'gas',
      'elpiji',
      'lpg',
    ],
    catHints: ['tagihan', 'utilitas', 'rutin', 'rumah', 'tempat tinggal', 'komunikasi', 'listrik'],
  },
  {
    type: 'expense',
    keywords: [
      'belanja',
      'indomaret',
      'alfamart',
      'alfamidi',
      'supermarket',
      'minimarket',
      'superindo',
      'hypermart',
      'transmart',
      'pasar',
      'sayur',
      'buah',
      'beras',
      'minyak goreng',
      'telur',
      'sabun',
      'shampoo',
      'sampo',
      'odol',
      'detergen',
      'tisu',
      'skincare',
      'kosmetik',
      'baju',
      'celana',
      'sepatu',
      'tas',
      'shopee',
      'tokped',
      'tokopedia',
      'lazada',
      'blibli',
      'groceries',
      'bulanan',
      'kebutuhan',
    ],
    catHints: ['belanja', 'kebutuhan', 'groceries', 'harian', 'pribadi'],
  },
  {
    type: 'expense',
    keywords: [
      'obat',
      'apotek',
      'apotik',
      'dokter',
      'klinik',
      'rs',
      'rumah sakit',
      'puskesmas',
      'vitamin',
      'suplemen',
      'medical',
      'checkup',
      'lab',
      'dokter gigi',
      'gigi',
      'kacamata',
      'masker',
      'kesehatan',
      'berobat',
      'terapi',
    ],
    catHints: ['kesehatan', 'medis', 'obat', 'dokter'],
  },
  {
    type: 'expense',
    keywords: [
      'nonton',
      'bioskop',
      'xxi',
      'cgv',
      'netflix',
      'spotify',
      'youtube',
      'disney',
      'vidio',
      'game',
      'steam',
      'karaoke',
      'konser',
      'wisata',
      'liburan',
      'rekreasi',
      'hotel',
      'staycation',
      'gym',
      'olahraga',
      'futsal',
      'badminton',
      'komik',
      'hobi',
      'hiburan',
    ],
    catHints: ['hiburan', 'gaya hidup', 'rekreasi', 'hobi', 'langganan', 'olahraga'],
  },
  {
    type: 'expense',
    keywords: [
      'kursus',
      'les',
      'sekolah',
      'kuliah',
      'spp',
      'ukt',
      'seminar',
      'workshop',
      'udemy',
      'bootcamp',
      'alat tulis',
      'atk',
      'fotokopi',
      'print',
      'pendidikan',
      'buku',
    ],
    catHints: ['pendidikan', 'belajar', 'sekolah', 'kursus'],
  },
  {
    type: 'expense',
    keywords: [
      'donasi',
      'sedekah',
      'infaq',
      'infak',
      'zakat',
      'amal',
      'sumbangan',
      'kado',
      'hadiah',
      'angpao',
      'kondangan',
      'amplop',
      'traktir',
    ],
    catHints: ['donasi', 'amal', 'sosial', 'hadiah', 'keluarga', 'sedekah'],
  },
  {
    type: 'income',
    keywords: ['gaji', 'gajian', 'upah', 'salary', 'payroll'],
    catHints: ['gaji', 'utama', 'penghasilan'],
  },
  {
    type: 'income',
    keywords: ['bonus', 'thr', 'insentif', 'tunjangan'],
    catHints: ['bonus', 'thr', 'tambahan', 'lainnya'],
  },
  {
    type: 'income',
    keywords: [
      'freelance',
      'proyek',
      'project',
      'honor',
      'fee',
      'jasa',
      'komisi',
      'penjualan',
      'jualan',
      'orderan',
    ],
    catHints: ['freelance', 'sampingan', 'usaha', 'bisnis', 'tambahan', 'lainnya'],
  },
  {
    type: 'income',
    keywords: [
      'dividen',
      'bunga',
      'kupon',
      'bagi hasil',
      'profit',
      'cuan',
      'investasi',
      'deposito',
    ],
    catHints: ['investasi', 'dividen', 'bunga', 'tambahan', 'lainnya'],
  },
  {
    type: 'income',
    keywords: ['refund', 'cashback', 'reimburse', 'kembalian', 'hadiah', 'hibah'],
    catHints: ['lainnya', 'lain', 'tambahan', 'refund'],
  },
];

const NON_ALNUM_RE = /[^\p{L}\p{N}]+/gu;
const COMBINING_RE = /\p{M}/gu;

function normWord(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_RE, '')
    .replace(NON_ALNUM_RE, '');
}

function tokenizeWords(s: string): string[] {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_RE, '')
    .split(NON_ALNUM_RE)
    .filter((w) => w !== '');
}

/** Alias umum dompet tunai Indonesia. */
const WALLET_SYNONYMS: Record<string, readonly string[]> = {
  cash: ['tunai', 'kas'],
  tunai: ['cash', 'kas'],
};

interface NaturalWalletExtraction {
  wallet: WalletOption | null;
  ambiguous: boolean;
  description: string;
}

/**
 * Mencari penyebutan dompet alami tanpa `@` di dalam teks deskripsi.
 * Memprioritaskan nama dompet yang lebih panjang (mis. "BCA Syariah" sebelum "BCA"),
 * dan menghapus preposisi (`pakai`/`pake`/`via`/`dari`/`di`/`ke`) tepat sebelum nama dompet.
 */
function extractNaturalWallet(
  description: string,
  wallets: readonly WalletOption[],
): NaturalWalletExtraction {
  if (wallets.length === 0 || description.trim() === '') {
    return { wallet: null, ambiguous: false, description };
  }
  const rawTokens = description.trim().split(/\s+/);
  const normTokens = rawTokens.map(normWord);

  interface Candidate {
    wallet: WalletOption;
    start: number;
    end: number; // exclusive
    exactName: boolean;
    len: number;
  }

  const candidates: Candidate[] = [];

  for (const w of wallets) {
    const wWords = tokenizeWords(w.name);
    if (wWords.length === 0) continue;

    // 1. Cocokkan urutan kata persis nama dompet (mis. ["kas", "kantor"] atau ["bca"]).
    for (let i = 0; i <= normTokens.length - wWords.length; i++) {
      let ok = true;
      for (let j = 0; j < wWords.length; j++) {
        if (normTokens[i + j] !== wWords[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        candidates.push({
          wallet: w,
          start: i,
          end: i + wWords.length,
          exactName: true,
          len: wWords.length,
        });
      }
    }

    // 2. Nama gabungan satu token (mis. dompet "GoPay" atau "Go Pay" vs "gopay").
    const joined = wWords.join('');
    if (wWords.length > 1 && joined.length >= 3) {
      for (let i = 0; i < normTokens.length; i++) {
        if (normTokens[i] === joined) {
          candidates.push({
            wallet: w,
            start: i,
            end: i + 1,
            exactName: true,
            len: wWords.length,
          });
        }
      }
    }

    // 3. Sinonim tunai <-> cash (hanya bila nama dompet satu kata).
    if (wWords.length === 1 && wWords[0] !== undefined) {
      const syns = WALLET_SYNONYMS[wWords[0]];
      if (syns) {
        for (let i = 0; i < normTokens.length; i++) {
          const tok = normTokens[i];
          if (tok !== undefined && syns.includes(tok)) {
            candidates.push({
              wallet: w,
              start: i,
              end: i + 1,
              exactName: false,
              len: 1,
            });
          }
        }
      }
    }
  }

  if (candidates.length === 0) {
    return { wallet: null, ambiguous: false, description };
  }

  // Pilih kecocokan paling spesifik: exactName dulu, lalu jumlah kata terbanyak.
  candidates.sort((a, b) => {
    if (a.exactName !== b.exactName) return a.exactName ? -1 : 1;
    if (a.len !== b.len) return b.len - a.len;
    return a.start - b.start;
  });

  const best = candidates[0];
  if (!best) {
    return { wallet: null, ambiguous: false, description };
  }
  // Cek apakah ada dompet berbeda dengan prioritas sama kuatnya.
  const distinctBest = new Set(
    candidates
      .filter((c) => c.exactName === best.exactName && c.len === best.len)
      .map((c) => c.wallet.id),
  );
  if (distinctBest.size > 1) {
    return { wallet: null, ambiguous: true, description };
  }

  // Hapus token nama dompet (+ preposisi tepat di depannya bila ada).
  let cutStart = best.start;
  if (cutStart > 0) {
    const prev = normTokens[cutStart - 1];
    if (prev !== undefined && WALLET_PREPOSITIONS.has(prev)) {
      cutStart -= 1;
    }
  }
  const kept = [...rawTokens.slice(0, cutStart), ...rawTokens.slice(best.end)];
  return {
    wallet: best.wallet,
    ambiguous: false,
    description: kept.join(' ').trim(),
  };
}

/**
 * Cocokkan teks keterangan ke kategori aktif ruang yang jenisnya sama (`expense` / `income`).
 * Selalu mengembalikan `id` dari daftar `categories` yang diberikan, atau `null`.
 */
export function matchCategoryByRules(
  description: string,
  type: 'income' | 'expense',
  categories: readonly RuleCategoryOption[],
): string | null {
  const pool = categories.filter((c) => c.type === type);
  if (pool.length === 0) return null;

  const tokens = tokenizeWords(description);
  if (tokens.length === 0) return null;
  const phrase = ` ${tokens.join(' ')} `;
  const tokenSet = new Set(tokens);

  const scores = new Map<string, number>();
  const addScore = (id: string, delta: number) => {
    scores.set(id, (scores.get(id) ?? 0) + delta);
  };

  // 1. Kecocokan langsung terhadap nama kategori aktif.
  for (const cat of pool) {
    const catWords = tokenizeWords(cat.name);
    if (catWords.length === 0) continue;
    const catPhrase = ` ${catWords.join(' ')} `;
    if (phrase.includes(catPhrase)) {
      addScore(cat.id, 10 + catWords.length);
      continue;
    }
    for (const cw of catWords) {
      if (cw.length >= 3 && tokenSet.has(cw)) {
        addScore(cat.id, 6);
      }
    }
  }

  // 2. Kecocokan kamus kata kunci Bahasa Indonesia → hint nama kategori aktif.
  for (const rule of CATEGORY_RULES) {
    if (rule.type !== type) continue;
    let matchedWeight = 0;
    for (const kw of rule.keywords) {
      if (kw.includes(' ')) {
        if (phrase.includes(` ${kw} `)) matchedWeight += 5;
      } else if (tokenSet.has(kw)) {
        matchedWeight += 3;
      }
    }
    if (matchedWeight === 0) continue;
    for (const cat of pool) {
      const catLower = tokenizeWords(cat.name).join(' ');
      if (rule.catHints.some((hint) => catLower.includes(hint))) {
        addScore(cat.id, matchedWeight);
      }
    }
  }

  let bestId: string | null = null;
  let bestScore = 0;
  let tied = false;
  for (const [id, score] of scores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }
  return tied ? null : bestId;
}

function cleanDescription(raw: string): string {
  let cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/^[,.\-–—:;]+|[,.\-–—:;]+$/g, '')
    .trim();
  // Hapus preposisi menggantung di ujung jika ada.
  const parts = cleaned.split(' ').filter((w) => w !== '');
  while (parts.length > 1) {
    const last = normWord(parts[parts.length - 1] ?? '');
    if (WALLET_PREPOSITIONS.has(last)) parts.pop();
    else break;
  }
  cleaned = parts.join(' ').trim();
  if (cleaned === '') return '';
  return cleaned.slice(0, 200);
}

/**
 * Parse teks bebas Catat menggunakan aturan murni.
 */
export function parseByRules(input: RuleParseInput): RuleParseResult {
  const maxAmount = input.maxAmount ?? MAX_LLM_AMOUNT;
  const trimmed = input.text.trim().replace(/\s+/g, ' ').slice(0, MAX_FREE_TEXT_LENGTH);
  if (trimmed === '') {
    return { ok: false, reason: 'empty', hardReject: true };
  }

  // Tolak tegas kata tanggal masa depan ("besok", "lusa" tanpa "kemarin").
  if (FUTURE_WORD_RE.test(trimmed)) {
    return { ok: false, reason: 'future_date', hardReject: true };
  }

  // Ekstrak penanda tanggal alami web ("2 hari lalu", "hari ini") sebelum parseMessage.
  const webDateState: { spec: DateSpec | undefined; count: number; bad: boolean } = {
    spec: undefined,
    count: 0,
    bad: false,
  };

  let preprocessed = trimmed.replace(DAYS_AGO_RE, (_m, nStr: string) => {
    const n = Number(nStr);
    webDateState.count += 1;
    if (!Number.isSafeInteger(n) || n < 1) {
      webDateState.bad = true;
    } else {
      webDateState.spec = { kind: 'ago', days: n };
    }
    return ' ';
  });

  preprocessed = preprocessed.replace(TODAY_PHRASE_RE, () => {
    webDateState.count += 1;
    webDateState.spec = { kind: 'ago', days: 0 };
    return ' ';
  });

  if (webDateState.bad) {
    return { ok: false, reason: 'bad_date', hardReject: true };
  }
  if (webDateState.count > 1) {
    return { ok: false, reason: 'bad_date', hardReject: false };
  }

  // Jika teks tidak menggunakan penanda `@dompet`, ekstrak dompet alami SEBELUM parseMessage
  // agar nama dompet yang mengandung angka (mis. "BCA 2", "Kas S17") tidak bentrok dengan nominal.
  const hasAtWallet = /(?:^|\s)@\S/u.test(preprocessed);
  let preWallet: WalletOption | null = null;
  let preWalletAmbiguous = false;
  if (!hasAtWallet) {
    const natPre = extractNaturalWallet(preprocessed, input.wallets);
    preWallet = natPre.wallet;
    preWalletAmbiguous = natPre.ambiguous;
    if (natPre.wallet !== null) {
      preprocessed = natPre.description;
    }
  }

  // Lindungi kata "bersama" dan awalan "b " agar tidak dibuang oleh parser WA
  // (di web, ruang aktif sudah dipilih pengguna di sheet).
  const waSafe = preprocessed
    .replace(/\bbersama\b/giu, BERSAMA_TOKEN)
    .replace(/^b(?=\s)/iu, '__dkb__');

  const wa = parseMessage(waSafe, { maxAmount });

  if (wa.kind === 'cancel' || wa.kind === 'link') {
    return { ok: false, reason: 'no_amount', hardReject: false };
  }
  if (wa.kind === 'reject') {
    switch (wa.reason) {
      case 'empty':
        return { ok: false, reason: 'empty', hardReject: true };
      case 'too_large':
        return { ok: false, reason: 'too_large', hardReject: true };
      case 'bad_date':
      case 'many_dates':
        return { ok: false, reason: 'bad_date', hardReject: false };
      case 'many_amounts':
        return { ok: false, reason: 'many_amounts', hardReject: false };
      case 'bad_amount':
        return { ok: false, reason: 'bad_amount', hardReject: false };
      default:
        return { ok: false, reason: 'no_amount', hardReject: false };
    }
  }

  // Gabungkan tanggal web & tanggal dari wa/parse (tolak jika keduanya ada).
  if (webDateState.spec !== undefined && wa.date !== undefined) {
    return { ok: false, reason: 'bad_date', hardReject: false };
  }
  const dateSpec = webDateState.spec ?? wa.date;
  let occurredOn: IsoDate | null = null;
  if (dateSpec !== undefined) {
    const resolved = resolveDate(dateSpec, input.today);
    if (!resolved.ok) {
      if (resolved.reason === 'future') {
        return { ok: false, reason: 'future_date', hardReject: true };
      }
      if (resolved.reason === 'too_old') {
        return { ok: false, reason: 'too_old_date', hardReject: true };
      }
      return { ok: false, reason: 'bad_date', hardReject: true };
    }
    occurredOn = resolved.iso;
  }

  // Kembalikan token yang dilindungi.
  let desc = wa.description
    .replace(new RegExp(BERSAMA_TOKEN, 'g'), 'bersama')
    .replace(/\b__dkb__\b/g, 'b');

  // Tentukan pemasukan/pengeluaran (perluasan kata pemicu pemasukan web).
  let type: 'income' | 'expense' = wa.type;
  const descTokens = tokenizeWords(desc);
  if (type === 'expense') {
    const hasExtraIncome = descTokens.some((t) => EXTRA_INCOME_WORDS.has(t));
    const hasStrongExpense = descTokens.some((t) => STRONG_EXPENSE_WORDS.has(t));
    const hasStrongIncome = descTokens.some((t) => STRONG_INCOME_WORDS.has(t));
    if (hasStrongIncome || (hasExtraIncome && !hasStrongExpense)) {
      type = 'income';
    }
  }

  // Tentukan dompet: @marker lebih dulu, lalu hasil ekstraksi alami sebelum/sesudah parseMessage.
  let accountId: string | null = null;
  let walletAmbiguous = preWalletAmbiguous;
  if (wa.wallet !== undefined) {
    const m = matchWallet(wa.wallet, input.wallets);
    if (m.kind === 'found') accountId = m.wallet.id;
    else walletAmbiguous = true;
  } else if (preWallet !== null) {
    accountId = preWallet.id;
  } else {
    const nat = extractNaturalWallet(desc, input.wallets);
    if (nat.wallet !== null) {
      accountId = nat.wallet.id;
      desc = nat.description;
    } else if (nat.ambiguous) {
      walletAmbiguous = true;
    }
  }

  const finalDesc = cleanDescription(desc);
  const categoryId = matchCategoryByRules(finalDesc, type, input.categories);

  // Keyakinan tinggi jika nominal & deskripsi jelas dan tidak ada dompet ambigu.
  // Jika deskripsi cukup panjang (>2 kata) namun kategori belum cocok dan ada kategori di ruang,
  // beri confidence 'low' agar LLM (bila aktif & berkuota) bisa menyempurnakan kategori/dompet.
  const wordCount = tokenizeWords(finalDesc).length;
  const hasCategoriesForType = input.categories.some((c) => c.type === type);
  const needsCategoryHelp = hasCategoriesForType && categoryId === null && wordCount >= 3;
  const confidence: 'high' | 'low' = walletAmbiguous || needsCategoryHelp ? 'low' : 'high';

  return {
    ok: true,
    confidence,
    entry: {
      type,
      amount: wa.amount,
      description: finalDesc,
      accountId,
      categoryId,
      occurredOn,
    },
  };
}
