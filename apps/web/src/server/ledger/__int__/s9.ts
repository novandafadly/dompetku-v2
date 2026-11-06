import { randomUUID } from 'node:crypto';
import { createPools, type Pools } from '../../db';
import { createBill, setBudget } from '../rencana';
import { resolveSpace } from '../space';
import {
  createAccount,
  createCategory,
  createEntry,
  createSpaceTransfer,
  type LedgerCtx,
} from '../write';
import { seedPersonas, type LedgerHarness, type Persona } from './harness';

/**
 * Fixture S9 (Task 9): jam DB tiruan (`app.now_override`, aktif hanya bila `app.settings env` =
 * `test`) dan satu skenario golden untuk Beranda, Rencana, dan Laporan. Angka golden dihitung
 * manual di komentar `GOLDEN`; tes membandingkan dengan angka ini, bukan menghitung ulang.
 *
 * Gajian 25 (K2) untuk rumah tangga tes. Hari ini fixture = Jum 6 Nov 2026 10:00 WIB: periode
 * berlabel November = 23 Okt (25 Okt Minggu → Jumat 23) s.d. 24 Nov, sisa 19 hari.
 */

export const OPENED = '2026-10-01T09:00:00+07:00';
export const TODAY = '2026-11-06T10:00:00+07:00';

export interface Clock {
  /** Pool `dompetku_web` dengan jam DB `at` (ISO dengan zona). */
  at(at: string): Pools;
  restore(): Promise<void>;
}

/** Set env `test` (jam tiruan aktif) dan kembalikan nilai semula di `restore`. */
export async function clockEnv(h: LedgerHarness): Promise<Clock> {
  const prev = await h.admin.query<{ value: string }>(
    `select value from app.settings where key = 'env'`,
  );
  await h.admin.query(`update app.settings set value = 'test' where key = 'env'`);
  const made: Pools[] = [];
  return {
    at(at: string): Pools {
      const v = process.env.TEST_DATABASE_URL;
      if (!v) throw new Error('TEST_DATABASE_URL wajib diisi');
      const u = new URL(v);
      u.searchParams.set('options', `-c app.now_override=${at}`);
      const pools = createPools(u.toString());
      made.push(pools);
      return pools;
    },
    async restore() {
      await h.admin.query(`update app.settings set value = $1 where key = 'env'`, [
        prev.rows[0]?.value ?? 'prod',
      ]);
      await Promise.all(made.flatMap((p) => [p.app.end(), p.auth.end()]));
    },
  };
}

export type Ctx = LedgerCtx & { kind: 'personal' | 'shared' };

export async function ctxAt(pools: Pools, p: Persona, ruang: 'pribadi' | 'bersama'): Promise<Ctx> {
  const { spaceId, kind } = await resolveSpace(pools, p.id, ruang);
  return { pools, userId: p.id, spaceId, kind };
}

export async function categoryNamed(
  h: LedgerHarness,
  spaceId: string,
  name: string,
): Promise<string> {
  const { rows } = await h.admin.query<{ id: string }>(
    'select id from app.categories where space_id = $1 and name = $2',
    [spaceId, name],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`kategori ${name} tidak ada`);
  return id;
}

export const KANARI = {
  nTagihan: 'KANARI-N-TAGIHAN',
  nKategori: 'KANARI-N-KATEGORI',
  nDompet: 'KANARI-N-DOMPET',
  fTagihan: 'KANARI-F-TAGIHAN',
  fDompet: 'KANARI-F-DOMPET',
  /** Nominal kanari Pribadi (memuatNominal). */
  nRp: 77_777,
  fRp: 93_331,
} as const;

/**
 * GOLDEN (Pribadi N, hari ini 6 Nov 2026, periode 23 Okt – 24 Nov, label November):
 * - saldo operasional = 10.000.000 (saldo awal 1 Okt) + 5.000.000 (gaji 25 Okt) − 1.700.000
 *   (makan 26 Okt) − 100.000 (Kesehatan 5 Nov) − 77.777 (kanari 2 Nov) − 600.000 (setor Bersama
 *   27 Okt) − 2.500 (biaya setor) = 12.519.723 (Kas Kantor bukan operasional);
 * - tagihan s.d. 24 Nov = 485.000 (jatuh tempo 10 Nov; 10 Des di luar periode);
 * - sisa anggaran wajib = 500.000 − 100.000 = 400.000;
 * - aman = 12.519.723 − 485.000 − 400.000 = 11.634.723; per hari = floor(11.634.723 / 19) =
 *   612.353;
 * - laju 30 hari (7 Okt – 5 Nov) = floor((1.700.000 + 100.000 + 77.777 + 2.500) / 30) = 62.675;
 * - Laporan November (gajian): Pemasukan 5.000.000, Pengeluaran 1.880.277 (biaya masuk, Kas
 *   Kantor 250.000 tidak), Selisih 3.119.723; bulan kalender November: Pengeluaran 177.777;
 * - anggaran: Makan 1.700.000 / 2.000.000 = 85% (hampir habis), Kesehatan (wajib) 20%, kanari 25%.
 * Bersama (N dan F): setor N 600.000 (27 Okt: periode gajian November, bukan Oktober kalender);
 * pengeluaran F 150.000 `Sayur & Buah` (4 Nov).
 */
export const GOLDEN = {
  from: '2026-10-23',
  to: '2026-11-24',
  labelMonth: '2026-11-01',
  label: 'November 2026 · 23 Okt – 24 Nov',
  daysLeft: 19,
  operasional: 12_519_723,
  bills: 485_000,
  wajib: 400_000,
  aman: 11_634_723,
  perDay: 612_353,
  avgDaily: 62_675,
  pemasukan: 5_000_000,
  pengeluaran: 1_880_277,
  selisih: 3_119_723,
  pengeluaranKalender: 177_777,
  kantor: 250_000,
  setor: 600_000,
  fee: 2_500,
  bersamaSetor: 600_000,
  bersamaBelanja: 150_000,
} as const;

export interface S9Fixture {
  n: Persona;
  f: Persona;
  luar: Persona;
  ids: {
    bca: string;
    kas: string;
    makan: string;
    kesehatan: string;
    tagihanCat: string;
    kanariCat: string;
    bill: string;
    fBill: string;
  };
}

/** Skenario golden; `clock` sudah aktif. Semua tulis lewat wrapper (jalan produksi). */
export async function seedS9(h: LedgerHarness, clock: Clock): Promise<S9Fixture> {
  const ps = await seedPersonas(h, { farida: 'bergabung', luar: true });
  const { n } = ps;
  if (!ps.f || !ps.luar) throw new Error('persona tidak lengkap');
  const f = ps.f;
  await h.admin.query('update app.households set payday_rule = 25');

  const opened = clock.at(OPENED);
  const nP = await ctxAt(opened, n, 'pribadi');
  const nB = await ctxAt(opened, n, 'bersama');
  const fP = await ctxAt(opened, f, 'pribadi');
  const wallet = async (
    ctx: LedgerCtx,
    name: string,
    openingBalance: number,
    pocket = 'operasional',
  ) =>
    (
      await createAccount(ctx, {
        clientId: randomUUID(),
        name,
        pocket: pocket as 'operasional' | 'kantor',
        walletType: 'bank',
        openingBalance,
      })
    ).accountId;
  const bca = await wallet(nP, KANARI.nDompet, 10_000_000);
  const kantor = await wallet(nP, 'Kas Kantor', 1_000_000, 'kantor');
  const kas = await wallet(nB, 'Kas Rumah', 0);
  const fBca = await wallet(fP, KANARI.fDompet, 3_000_000);

  const now = clock.at(TODAY);
  const p = await ctxAt(now, n, 'pribadi');
  const fb = await ctxAt(now, f, 'bersama');
  const fp = await ctxAt(now, f, 'pribadi');
  const makan = await categoryNamed(h, p.spaceId, 'Makan Siang & Minum');
  const kesehatan = await categoryNamed(h, p.spaceId, 'Kesehatan');
  const tagihanCat = await categoryNamed(h, p.spaceId, 'Cicilan & Tagihan');
  const dinas = await categoryNamed(h, p.spaceId, 'Perjalanan Dinas');
  const gaji = await categoryNamed(h, p.spaceId, 'Gaji');
  const { categoryId: kanariCat } = await createCategory(p, {
    clientId: randomUUID(),
    type: 'expense',
    name: KANARI.nKategori,
    icon: 'Tag',
  });

  await setBudget(p, { categoryId: makan, month: '2026-11', amount: 2_000_000, wajib: false });
  await setBudget(p, { categoryId: kesehatan, month: '2026-11', amount: 500_000, wajib: true });
  await setBudget(p, { categoryId: kanariCat, month: '2026-11', amount: 300_000, wajib: false });
  const { billId: bill } = await createBill(p, {
    clientId: randomUUID(),
    name: KANARI.nTagihan,
    amount: 485_000,
    categoryId: tagihanCat,
    dayOfMonth: 10,
    startsOn: '2026-11-01',
    accountId: bca,
  });

  const entry = (
    ctx: LedgerCtx,
    accountId: string,
    kind: 'income' | 'expense',
    amount: number,
    categoryId: string,
    occurredOn: string,
  ) =>
    createEntry(ctx, { clientId: randomUUID(), accountId, kind, amount, categoryId, occurredOn });
  await entry(p, bca, 'income', 5_000_000, gaji, '2026-10-25');
  await entry(p, bca, 'expense', 1_700_000, makan, '2026-10-26');
  await entry(p, bca, 'expense', 100_000, kesehatan, '2026-11-05');
  await entry(p, bca, 'expense', KANARI.nRp, kanariCat, '2026-11-02');
  await entry(p, kantor, 'expense', 250_000, dinas, '2026-11-03');
  await createSpaceTransfer(p, {
    clientId: randomUUID(),
    fromAccountId: bca,
    toSpaceId: fb.spaceId,
    toAccountId: kas,
    amount: 600_000,
    fee: 2_500,
    occurredOn: '2026-10-27',
    allowNegative: false,
  });
  await entry(
    fb,
    kas,
    'expense',
    150_000,
    await categoryNamed(h, fb.spaceId, 'Sayur & Buah'),
    '2026-11-04',
  );

  // Kanari Pribadi F: tagihan + pengeluaran.
  const { billId: fBill } = await createBill(fp, {
    clientId: randomUUID(),
    name: KANARI.fTagihan,
    amount: KANARI.fRp,
    categoryId: await categoryNamed(h, fp.spaceId, 'Cicilan & Tagihan'),
    dayOfMonth: 12,
    startsOn: '2026-11-01',
    accountId: fBca,
  });
  await entry(
    fp,
    fBca,
    'expense',
    KANARI.fRp,
    await categoryNamed(h, fp.spaceId, 'Langganan'),
    '2026-11-01',
  );

  return {
    n,
    f,
    luar: ps.luar,
    ids: { bca, kas, makan, kesehatan, tagihanCat, kanariCat, bill, fBill },
  };
}
