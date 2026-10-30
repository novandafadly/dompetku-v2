import { addDays, daysInclusive } from '@dompetku/domain';
import type { IsoDate, Rupiah } from '@dompetku/domain';
import type { Account, Bill, Budget, Category, DemoState, Entry, Member, Ruang } from './types';

const SEED = 20261030;
const MONTHS_BACK = 5;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

function monthStart(today: IsoDate, offset: number): IsoDate {
  const idx = Number(today.slice(0, 4)) * 12 + (Number(today.slice(5, 7)) - 1) + offset;
  return String(Math.floor(idx / 12)) + '-' + pad((idx % 12) + 1) + '-01';
}

/** 0 = Minggu. 2000-01-01 jatuh pada hari Sabtu. */
function weekday(d: IsoDate): number {
  return (6 + daysInclusive('2000-01-01', d) - 1) % 7;
}

const NOVANDA: Member = { id: 'm-novanda', name: 'Novanda', initial: 'N' };
const FARIDA: Member = { id: 'm-farida', name: 'Farida', initial: 'F' };

const CATEGORIES: Category[] = [
  {
    id: 'cp-gaji',
    ruang: 'pribadi',
    parentId: null,
    name: 'Gaji',
    type: 'income',
    icon: 'Briefcase',
  },
  {
    id: 'cp-makan',
    ruang: 'pribadi',
    parentId: null,
    name: 'Makan Siang & Minum',
    type: 'expense',
    icon: 'ForkKnife',
  },
  {
    id: 'cp-kopi',
    ruang: 'pribadi',
    parentId: null,
    name: 'Kopi & Camilan',
    type: 'expense',
    icon: 'Coffee',
  },
  {
    id: 'cp-transport',
    ruang: 'pribadi',
    parentId: null,
    name: 'Transportasi',
    type: 'expense',
    icon: 'Motorcycle',
  },
  {
    id: 'cp-belanja',
    ruang: 'pribadi',
    parentId: null,
    name: 'Belanja',
    type: 'expense',
    icon: 'ShoppingBag',
  },
  {
    id: 'cp-hiburan',
    ruang: 'pribadi',
    parentId: null,
    name: 'Hiburan',
    type: 'expense',
    icon: 'FilmSlate',
  },
  {
    id: 'cp-kesehatan',
    ruang: 'pribadi',
    parentId: null,
    name: 'Kesehatan',
    type: 'expense',
    icon: 'Heartbeat',
  },
  {
    id: 'cp-langganan',
    ruang: 'pribadi',
    parentId: null,
    name: 'Langganan',
    type: 'expense',
    icon: 'Repeat',
  },
  {
    id: 'cp-tagihan',
    ruang: 'pribadi',
    parentId: null,
    name: 'Cicilan & Tagihan',
    type: 'expense',
    icon: 'Receipt',
  },
  {
    id: 'cp-dinas',
    ruang: 'pribadi',
    parentId: null,
    name: 'Perjalanan Dinas',
    type: 'expense',
    icon: 'Briefcase',
  },
  {
    id: 'cb-kontribusi',
    ruang: 'bersama',
    parentId: null,
    name: 'Kontribusi Farida',
    type: 'income',
    icon: 'HandCoins',
  },
  {
    id: 'cb-sewa',
    ruang: 'bersama',
    parentId: null,
    name: 'Sewa Rumah',
    type: 'expense',
    icon: 'House',
  },
  {
    id: 'cb-listrik',
    ruang: 'bersama',
    parentId: null,
    name: 'Listrik & Air',
    type: 'expense',
    icon: 'Lightning',
  },
  {
    id: 'cb-internet',
    ruang: 'bersama',
    parentId: null,
    name: 'Internet',
    type: 'expense',
    icon: 'WifiHigh',
  },
  {
    id: 'cb-iuran',
    ruang: 'bersama',
    parentId: null,
    name: 'Iuran Lingkungan',
    type: 'expense',
    icon: 'UsersThree',
  },
  {
    id: 'cb-dapur',
    ruang: 'bersama',
    parentId: null,
    name: 'Belanja Dapur',
    type: 'expense',
    icon: 'ShoppingCart',
  },
  {
    id: 'cb-sayur',
    ruang: 'bersama',
    parentId: 'cb-dapur',
    name: 'Sayur & Buah',
    type: 'expense',
    icon: 'Carrot',
  },
  {
    id: 'cb-makanluar',
    ruang: 'bersama',
    parentId: null,
    name: 'Makan di Luar',
    type: 'expense',
    icon: 'ForkKnife',
  },
  {
    id: 'cb-transport',
    ruang: 'bersama',
    parentId: null,
    name: 'Bensin & Parkir',
    type: 'expense',
    icon: 'GasPump',
  },
];

type AccountSpec = Omit<Account, 'openedOn'> & { opening: Rupiah };

const ACCOUNTS: AccountSpec[] = [
  {
    id: 'acc-bca',
    ruang: 'pribadi',
    ownerId: NOVANDA.id,
    name: 'BCA',
    pocket: 'operasional',
    walletType: 'bank',
    opening: 500_000,
  },
  {
    id: 'acc-tunai',
    ruang: 'pribadi',
    ownerId: NOVANDA.id,
    name: 'Tunai',
    pocket: 'operasional',
    walletType: 'cash',
    opening: 500_000,
  },
  {
    id: 'acc-darurat',
    ruang: 'pribadi',
    ownerId: NOVANDA.id,
    name: 'Dana Darurat',
    pocket: 'tabungan',
    walletType: 'bank',
    opening: 15_000_000,
  },
  {
    id: 'acc-kantor',
    ruang: 'pribadi',
    ownerId: NOVANDA.id,
    name: 'Kas Kantor',
    pocket: 'kantor',
    walletType: 'cash',
    opening: 5_000_000,
  },
  {
    id: 'acc-rumah',
    ruang: 'bersama',
    ownerId: null,
    name: 'Kas Rumah',
    pocket: 'operasional',
    walletType: 'bank',
    opening: 6_000_000,
  },
  {
    id: 'acc-liburan',
    ruang: 'bersama',
    ownerId: null,
    name: 'Tabungan Liburan',
    pocket: 'tabungan',
    walletType: 'bank',
    opening: 8_000_000,
  },
];

/** Tagihan bulanan: dibayar bila tanggalnya sudah lewat; yang di bulan ini dibuat tagihan belum dibayar. */
interface Recurring {
  ruang: Ruang;
  name: string;
  categoryId: string;
  accountId: string;
  by: Member;
  dom: number;
  lo: number;
  hi: number;
  step: number;
  /** Tetap belum dibayar bila jatuh tempo sudah lewat di bulan berjalan (tunggakan). */
  lateUnpaid?: boolean;
}

const RECURRING: Recurring[] = [
  {
    ruang: 'bersama',
    name: 'Listrik PLN',
    categoryId: 'cb-listrik',
    accountId: 'acc-rumah',
    by: FARIDA,
    dom: 20,
    lo: 450_000,
    hi: 650_000,
    step: 1000,
  },
  {
    ruang: 'bersama',
    name: 'Internet rumah',
    categoryId: 'cb-internet',
    accountId: 'acc-rumah',
    by: NOVANDA,
    dom: 22,
    lo: 380_000,
    hi: 380_000,
    step: 1000,
  },
  {
    ruang: 'bersama',
    name: 'Air PDAM',
    categoryId: 'cb-listrik',
    accountId: 'acc-rumah',
    by: FARIDA,
    dom: 28,
    lo: 110_000,
    hi: 160_000,
    step: 1000,
  },
  {
    ruang: 'bersama',
    name: 'Iuran kebersihan RT',
    categoryId: 'cb-iuran',
    accountId: 'acc-rumah',
    by: FARIDA,
    dom: 14,
    lo: 150_000,
    hi: 150_000,
    step: 1000,
    lateUnpaid: true,
  },
  {
    ruang: 'pribadi',
    name: 'Cicilan ponsel',
    categoryId: 'cp-tagihan',
    accountId: 'acc-bca',
    by: NOVANDA,
    dom: 21,
    lo: 450_000,
    hi: 450_000,
    step: 1000,
  },
  {
    ruang: 'pribadi',
    name: 'Tagihan kartu kredit',
    categoryId: 'cp-tagihan',
    accountId: 'acc-bca',
    by: NOVANDA,
    dom: 24,
    lo: 700_000,
    hi: 950_000,
    step: 1000,
  },
];

export function createSeed(opts: { today: IsoDate; variant: 'empty' | 'full' }): DemoState {
  const { today } = opts;
  const members = [NOVANDA, FARIDA];
  if (opts.variant === 'empty') {
    return {
      today,
      members,
      accounts: [],
      categories: [],
      entries: [],
      bills: [],
      budgets: [],
      noSpendDays: [],
    };
  }

  const rng = mulberry32(SEED);
  const start = monthStart(today, -MONTHS_BACK);
  const thisMonth = monthStart(today, 0);
  const entries: Entry[] = [];
  const bills: Bill[] = [];

  const chance = (p: number) => rng() < p;
  const between = (lo: number, hi: number, step: number): Rupiah =>
    Math.max(step, step * Math.round((lo + rng() * (hi - lo)) / step));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)] ?? (xs[0] as T);
  const stamp = (date: IsoDate, h1: number, h2: number): string =>
    `${date}T${pad(h1 + Math.floor(rng() * (h2 - h1 + 1)))}:${pad(Math.floor(rng() * 60))}:${pad(Math.floor(rng() * 60))}+07:00`;

  const push = (e: Omit<Entry, 'id' | 'createdAt'> & { hours: [number, number] }) => {
    const { hours, ...rest } = e;
    entries.push({
      ...rest,
      id: 'e' + String(entries.length + 1),
      createdAt: stamp(e.occurredOn, ...hours),
    });
  };

  const accounts: Account[] = ACCOUNTS.map((spec) => ({
    id: spec.id,
    ruang: spec.ruang,
    ownerId: spec.ownerId,
    name: spec.name,
    pocket: spec.pocket,
    walletType: spec.walletType,
    openedOn: start,
  }));
  for (const spec of ACCOUNTS) {
    push({
      ruang: spec.ruang,
      kind: 'opening_balance',
      occurredOn: start,
      createdBy: NOVANDA.id,
      accountId: spec.id,
      amount: spec.opening,
      hours: [8, 9],
    });
  }

  let linkSeq = 0;
  const spaceTransfer = (date: IsoDate, amount: Rupiah, note: string) => {
    linkSeq += 1;
    const linkId = 'link' + String(linkSeq);
    push({
      ruang: 'pribadi',
      kind: 'space_transfer',
      direction: 'out',
      linkId,
      occurredOn: date,
      createdBy: NOVANDA.id,
      accountId: 'acc-bca',
      amount,
      description: note,
      hours: [9, 11],
    });
    push({
      ruang: 'bersama',
      kind: 'space_transfer',
      direction: 'in',
      linkId,
      occurredOn: date,
      createdBy: NOVANDA.id,
      accountId: 'acc-rumah',
      amount,
      hours: [9, 11],
    });
  };

  const lastDay = addDays(today, 0);
  for (let d = start; d <= lastDay; d = addDays(d, 1)) {
    const dom = Number(d.slice(8));
    const dow = weekday(d);
    const weekend = dow === 0 || dow === 6;
    const month = d.slice(0, 7);
    const pribadi = (
      accountId: string,
      categoryId: string,
      amount: Rupiah,
      description: string,
      hours: [number, number],
      extra: Partial<Entry> = {},
    ) => {
      push({
        ruang: 'pribadi',
        kind: 'expense',
        occurredOn: d,
        createdBy: NOVANDA.id,
        accountId,
        categoryId,
        amount,
        description,
        hours,
        ...extra,
      });
    };
    const bersama = (
      by: Member,
      categoryId: string,
      amount: Rupiah,
      description: string,
      hours: [number, number],
    ) => {
      push({
        ruang: 'bersama',
        kind: 'expense',
        occurredOn: d,
        createdBy: by.id,
        accountId: 'acc-rumah',
        categoryId,
        amount,
        description,
        hours,
      });
    };

    // Pemasukan dan perpindahan tetap bulanan.
    if (dom === 25) {
      push({
        ruang: 'pribadi',
        kind: 'income',
        occurredOn: d,
        createdBy: NOVANDA.id,
        accountId: 'acc-bca',
        categoryId: 'cp-gaji',
        amount: 12_000_000,
        description: 'Gaji bulanan',
        hours: [8, 9],
      });
    }
    if (dom === 26) {
      spaceTransfer(d, 3_000_000, 'Setoran bulanan ke Bersama');
      push({
        ruang: 'pribadi',
        kind: 'transfer',
        occurredOn: d,
        createdBy: NOVANDA.id,
        accountId: 'acc-bca',
        counterAccountId: 'acc-darurat',
        amount: 3_000_000,
        description: 'Tabung dana darurat',
        hours: [11, 12],
      });
    }
    if (dom === 12 && chance(0.5)) spaceTransfer(d, 500_000, 'Tambahan belanja rumah');
    if (dom === 27) {
      push({
        ruang: 'bersama',
        kind: 'income',
        occurredOn: d,
        createdBy: FARIDA.id,
        accountId: 'acc-rumah',
        categoryId: 'cb-kontribusi',
        amount: 9_000_000,
        description: 'Kontribusi bulanan Farida',
        hours: [8, 10],
      });
    }
    if (dom === 28) {
      push({
        ruang: 'bersama',
        kind: 'transfer',
        occurredOn: d,
        createdBy: FARIDA.id,
        accountId: 'acc-rumah',
        counterAccountId: 'acc-liburan',
        amount: 500_000,
        description: 'Tabungan liburan',
        hours: [10, 11],
      });
    }
    if (dom === 1) bersama(NOVANDA, 'cb-sewa', 4_500_000, 'Sewa rumah bulanan', [8, 10]);
    if (dom === 2) {
      push({
        ruang: 'pribadi',
        kind: 'transfer',
        occurredOn: d,
        createdBy: NOVANDA.id,
        accountId: 'acc-bca',
        counterAccountId: 'acc-tunai',
        amount: 1_000_000,
        description: 'Tarik tunai ATM',
        hours: [9, 12],
      });
    }
    if (dom === 3) pribadi('acc-bca', 'cp-langganan', 54_000, 'Langganan streaming', [7, 9]);
    if (dom === 5) pribadi('acc-bca', 'cp-langganan', 100_000, 'Paket data bulanan', [7, 9]);

    // Tagihan berulang dan tagihan berjalan.
    for (const r of RECURRING) {
      if (dom !== r.dom) continue;
      const amount = between(r.lo, r.hi, r.step);
      const current = month === thisMonth.slice(0, 7);
      if (current && r.lateUnpaid) {
        bills.push({
          id: 'b' + String(bills.length + 1),
          ruang: r.ruang,
          name: r.name,
          amount,
          dueOn: d,
          posted: false,
        });
        continue;
      }
      push({
        ruang: r.ruang,
        kind: 'expense',
        occurredOn: d,
        createdBy: r.by.id,
        accountId: r.accountId,
        categoryId: r.categoryId,
        amount,
        description: r.name,
        hours: [9, 15],
      });
      bills.push({
        id: 'b' + String(bills.length + 1),
        ruang: r.ruang,
        name: r.name,
        amount,
        dueOn: d,
        posted: true,
      });
    }

    // Pengeluaran harian Pribadi.
    if (chance(weekend ? 0.55 : 0.85)) {
      pribadi(
        chance(0.4) ? 'acc-tunai' : 'acc-bca',
        'cp-makan',
        between(25_000, 75_000, 500),
        pick(['Warung makan', 'Nasi campur', 'Mie ayam', 'Makan siang kantin', 'Bakso']),
        [11, 13],
      );
    }
    if (chance(0.5)) {
      pribadi(
        chance(0.5) ? 'acc-tunai' : 'acc-bca',
        'cp-kopi',
        between(18_000, 45_000, 500),
        pick(['Kopi susu', 'Teh dingin', 'Roti & kopi', 'Camilan']),
        [8, 16],
      );
    }
    if (!weekend && chance(0.7)) {
      pribadi(
        chance(0.5) ? 'acc-tunai' : 'acc-bca',
        'cp-transport',
        between(15_000, 60_000, 500),
        pick(['Ojek online', 'Parkir', 'Tol & parkir', 'Transjakarta']),
        [6, 18],
      );
    }
    if (chance(0.08))
      pribadi(
        'acc-bca',
        'cp-belanja',
        between(100_000, 400_000, 1000),
        pick(['Belanja online', 'Pakaian', 'Perlengkapan harian']),
        [12, 20],
      );
    if (chance(0.05))
      pribadi(
        'acc-bca',
        'cp-hiburan',
        between(60_000, 250_000, 1000),
        pick(['Bioskop', 'Game', 'Nongkrong']),
        [17, 21],
      );
    if (chance(0.04))
      pribadi(
        'acc-bca',
        'cp-kesehatan',
        between(50_000, 300_000, 1000),
        pick(['Apotek', 'Vitamin', 'Dokter umum']),
        [9, 18],
      );

    // Kantor, bisa diganti kantor.
    if (!weekend && (dom === 9 || dom === 22)) {
      pribadi(
        'acc-kantor',
        'cp-dinas',
        between(80_000, 350_000, 1000),
        pick(['Transport ke klien', 'Makan bersama klien', 'Parkir dinas']),
        [10, 17],
        { reimbursable: true },
      );
    }

    // Pengeluaran Bersama, dicatat bergantian.
    if (weekend) {
      if (chance(0.9)) {
        const sayur = chance(0.4);
        bersama(
          chance(0.5) ? NOVANDA : FARIDA,
          sayur ? 'cb-sayur' : 'cb-dapur',
          between(150_000, 350_000, 1000),
          sayur ? 'Pasar sayur & buah' : pick(['Belanja mingguan', 'Supermarket', 'Minimarket']),
          [8, 12],
        );
      }
      if (chance(0.85))
        bersama(
          chance(0.5) ? NOVANDA : FARIDA,
          'cb-makanluar',
          between(120_000, 280_000, 1000),
          pick(['Makan malam berdua', 'Brunch akhir pekan', 'Restoran keluarga']),
          [12, 20],
        );
    } else {
      if (chance(0.15))
        bersama(
          chance(0.5) ? NOVANDA : FARIDA,
          'cb-dapur',
          between(40_000, 120_000, 500),
          'Belanja kebutuhan dapur',
          [16, 19],
        );
      if (chance(0.1))
        bersama(
          chance(0.5) ? NOVANDA : FARIDA,
          'cb-transport',
          between(150_000, 300_000, 1000),
          'Bensin mobil',
          [7, 18],
        );
    }
  }

  // Tagihan belum dibayar bulan ini yang jatuh tempo setelah hari ini.
  for (const r of RECURRING) {
    const due = thisMonth.slice(0, 8) + pad(r.dom);
    if (
      due > today &&
      !bills.some((b) => b.ruang === r.ruang && b.name === r.name && b.dueOn === due)
    ) {
      bills.push({
        id: 'b' + String(bills.length + 1),
        ruang: r.ruang,
        name: r.name,
        amount: between(r.lo, r.hi, r.step),
        dueOn: due,
        posted: false,
      });
    }
  }

  const budgets: Budget[] = [];
  for (let off = -2; off <= 0; off += 1) {
    const month = monthStart(today, off);
    const mk = (ruang: Ruang, categoryId: string, amount: Rupiah, wajib: boolean) =>
      budgets.push({ ruang, categoryId, month, amount, wajib });
    mk('pribadi', 'cp-makan', 2_000_000, false);
    mk('pribadi', 'cp-transport', 700_000, false);
    mk('pribadi', 'cp-langganan', 180_000, true);
    mk('bersama', 'cb-sewa', 4_500_000, true);
    mk('bersama', 'cb-listrik', 800_000, false);
    mk('bersama', 'cb-dapur', 3_000_000, false);
    mk('bersama', 'cb-makanluar', 1_000_000, false);
  }

  return {
    today,
    members,
    accounts,
    categories: CATEGORIES,
    entries,
    bills,
    budgets,
    noSpendDays: [],
  };
}
