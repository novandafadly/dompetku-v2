import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPools, withUser, type Pools } from '../../db';
import {
  accountEntries,
  getEntry,
  listAccounts,
  listCategories,
  listEntries,
  monthSummary,
  recentEntries,
  safeToSpend,
  suggestCategories,
  todayStatus,
  trashList,
} from '../read';
import { createReimbursement } from '../reimburse';
import {
  createAccount,
  createCategory,
  createEntry,
  createSpaceTransfer,
  createTransfer,
  markNoSpendDay,
  restoreEntry,
  voidEntry,
  type LedgerCtx,
} from '../write';
import {
  createLedgerHarness,
  memuatNominal,
  resetLedger,
  seedPersonas,
  spaceIdOf,
  type Persona,
  type Personas,
} from './harness';

const h = createLedgerHarness();
const WIB_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/;

afterAll(async () => {
  await h.close();
});

function must<T>(p: T | null | undefined): T {
  if (p === null || p === undefined) throw new Error('nilai tidak ada');
  return p;
}

/** Saldo dari baris jurnal yang tidak batal (superuser, pembanding independen). */
async function balance(accountId: string): Promise<number> {
  const { rows } = await h.admin.query<{ b: number }>(
    `select coalesce(sum(l.amount), 0)::int as b
       from app.entry_lines l join app.entries e on e.id = l.entry_id
      where l.account_id = $1 and e.voided_at is null`,
    [accountId],
  );
  return rows[0]?.b ?? NaN;
}

/** Kategori awal ruang, urut sort_order (lahir dari trigger seed saat anggota masuk). */
async function categoriesOf(spaceId: string, type: 'income' | 'expense'): Promise<string[]> {
  const { rows } = await h.admin.query<{ id: string }>(
    `select id from app.categories
      where space_id = $1 and type = $2 and parent_id is null and archived_at is null
      order by sort_order`,
    [spaceId, type],
  );
  if (rows.length === 0) throw new Error('kategori awal tidak ada');
  return rows.map((r) => r.id);
}

async function categoryOf(spaceId: string, type: 'income' | 'expense'): Promise<string> {
  return must((await categoriesOf(spaceId, type))[0]);
}

/** Tanggal WIB server sekarang (`app.today()`), bukan jam Node. */
async function dbToday(): Promise<string> {
  const { rows } = await h.admin.query<{ d: string }>('select app.today()::text as d');
  return must(rows[0]?.d);
}

/** Bulan WIB server sekarang (`app.today()`), bukan jam Node. */
async function currentMonth(): Promise<string> {
  const { rows } = await h.admin.query<{ m: string }>(
    `select to_char(app.today(), 'YYYY-MM') as m`,
  );
  return must(rows[0]?.m);
}

async function wallet(ctx: LedgerCtx, openingBalance: number, name = 'BCA'): Promise<string> {
  const { accountId } = await createAccount(ctx, {
    clientId: randomUUID(),
    name,
    pocket: 'operasional',
    walletType: 'bank',
    openingBalance,
  });
  return accountId;
}

async function expense(
  ctx: LedgerCtx,
  accountId: string,
  amount: number,
  extra: { description?: string; categoryId?: string; occurredOn?: string } = {},
): Promise<string> {
  const { entryId } = await createEntry(ctx, {
    clientId: randomUUID(),
    accountId,
    kind: 'expense',
    amount,
    categoryId: extra.categoryId ?? (await categoryOf(ctx.spaceId, 'expense')),
    ...(extra.description === undefined ? {} : { description: extra.description }),
    ...(extra.occurredOn === undefined ? {} : { occurredOn: extra.occurredOn }),
  });
  return entryId;
}

/** Transfer antar ruang langsung lewat `api.create_transfer` (wrapper S6 hanya satu ruang). */
async function spaceTransfer(
  userId: string,
  spaceId: string,
  from: string,
  to: string,
  amount: number,
  description: string,
  sharedNote: string,
): Promise<{ entryId: string; linkedEntryId: string }> {
  return withUser(h.pools.app, userId, async (c) => {
    const { rows } = await c.query<{ r: { entry_id: string; linked_entry_id: string } }>(
      `select api.create_transfer(
         p_client_id => $1, p_space_id => $2, p_from_account => $3, p_to_account => $4,
         p_amount => $5::bigint, p_description => $6, p_shared_note => $7) as r`,
      [randomUUID(), spaceId, from, to, amount, description, sharedNote],
    );
    const r = must(rows[0]?.r);
    return { entryId: r.entry_id, linkedEntryId: r.linked_entry_id };
  });
}

/** Cocokkan saldo lewat `api.reconcile_balance` (belum ada wrapper S6); id entri adjustment. */
async function reconcile(userId: string, accountId: string, target: number): Promise<string> {
  return withUser(h.pools.app, userId, async (c) => {
    const { rows } = await c.query<{ r: { entry_id: string } }>(
      `select api.reconcile_balance(
         p_client_id => $1, p_account_id => $2, p_target_balance => $3::bigint) as r`,
      [randomUUID(), accountId, target],
    );
    return must(rows[0]?.r.entry_id);
  });
}

/** Semua loader untuk satu ruang; hasilnya digabung untuk diperiksa kanari. */
async function readEverything(ctx: LedgerCtx, month: string, foreignIds: string[]) {
  const accounts = await listAccounts(ctx);
  const entries = await listEntries(ctx, { month });
  const perAccount = await Promise.all(
    accounts.map((a) => listEntries(ctx, { month, accountId: a.id })),
  );
  const details = await Promise.all(entries.map((e) => getEntry(ctx, e.id)));
  const trash = await trashList(ctx);
  const trashDetails = await Promise.all(trash.map((t) => getEntry(ctx, t.entry.id)));
  return {
    accounts,
    categories: await listCategories(ctx, { includeArchived: true }),
    suggestExpense: await suggestCategories(ctx, { type: 'expense' }),
    suggestIncome: await suggestCategories(ctx, { type: 'income', hour: 9, amount: 7_777_777 }),
    entries,
    perAccount,
    recent: await recentEntries(ctx, 100),
    details,
    trash,
    trashDetails,
    summary: await monthSummary(ctx, month),
    safe: await safeToSpend(ctx),
    today: await todayStatus(ctx),
    // Id ruang lain yang disodorkan ke loader ruang ini: tidak boleh terbaca.
    foreign: await Promise.all(foreignIds.map((id) => getEntry(ctx, id))),
    foreignAccounts: await Promise.all(
      foreignIds.map((accountId) => listEntries(ctx, { month, accountId })),
    ),
  };
}

const KANARI_DESC = 'KANARI-FARIDA-PRIBADI-7f3a';
const KANARI_DOMPET = 'KANARI-DOMPET-F';
const KANARI_RP = 7_777_777;

describe('loader baca ledger (N dan F bergabung)', () => {
  let ps: Personas;
  let f: Persona;
  let nPribadi: LedgerCtx;
  let nBersama: LedgerCtx;
  let fPribadi: LedgerCtx;
  let fBersama: LedgerCtx;

  beforeEach(async () => {
    await resetLedger(h);
    ps = await seedPersonas(h, { farida: 'bergabung' });
    f = must(ps.f);
    const shared = await spaceIdOf(h, ps.n.id, 'shared');
    nPribadi = {
      pools: h.pools,
      userId: ps.n.id,
      spaceId: await spaceIdOf(h, ps.n.id, 'personal'),
    };
    nBersama = { pools: h.pools, userId: ps.n.id, spaceId: shared };
    fPribadi = { pools: h.pools, userId: f.id, spaceId: await spaceIdOf(h, f.id, 'personal') };
    fBersama = { pools: h.pools, userId: f.id, spaceId: shared };
  });

  describe('privasi Bersama (Review Focus 4)', () => {
    /**
     * Kanari di ruang Pribadi `owner`, dibaca `reader` lewat ruang Bersama. Nama kanari menyebut
     * Farida, tetapi brief menaruhnya "milik N" dan pembacanya F (tes pertama); tes kedua membalik
     * arah, tes ketiga menaruhnya di Pribadi pembaca sendiri.
     */
    async function canaryCase(
      owner: { pribadi: LedgerCtx; bersama: LedgerCtx },
      reader: LedgerCtx,
    ) {
      const month = await currentMonth();
      const kAcc = await wallet(owner.pribadi, 20_000_000, KANARI_DOMPET);
      const kAcc2 = await wallet(owner.pribadi, 0, `${KANARI_DOMPET}-2`);
      const { categoryId: kCat } = await createCategory(owner.pribadi, {
        clientId: randomUUID(),
        type: 'expense',
        name: KANARI_DESC,
        icon: 'Coffee',
      });
      const p1 = await expense(owner.pribadi, kAcc, KANARI_RP, {
        description: KANARI_DESC,
        categoryId: kCat,
      });
      const p2 = await expense(owner.pribadi, kAcc, KANARI_RP, { description: KANARI_DESC });
      await voidEntry(owner.pribadi, { clientId: randomUUID(), entryId: p2, expectedVersion: 1 });
      const { entryId: p3 } = await createTransfer(owner.pribadi, {
        clientId: randomUUID(),
        fromAccountId: kAcc,
        toAccountId: kAcc2,
        amount: KANARI_RP,
        description: KANARI_DESC,
      });
      await markNoSpendDay(owner.pribadi);

      // Ruang Bersama: dompet bersama, pengeluaran pembaca (satu dibatalkan), transfer dua arah.
      const kas = await wallet(owner.bersama, 3_000_000, 'Kas Rumah');
      await expense(reader, kas, 150_000, { description: 'Belanja sayur' });
      const voided = await expense(reader, kas, 60_000, { description: 'Galon' });
      await voidEntry(reader, { clientId: randomUUID(), entryId: voided, expectedVersion: 1 });
      const setor = await spaceTransfer(
        owner.pribadi.userId,
        owner.pribadi.spaceId,
        kAcc,
        kas,
        1_250_000,
        KANARI_DESC,
        'Setoran Oktober',
      );
      const ambil = await spaceTransfer(
        owner.pribadi.userId,
        owner.bersama.spaceId,
        kas,
        kAcc,
        300_000,
        KANARI_DESC,
        'Ambil kembali',
      );

      const pribadiIds = [kAcc, kAcc2, kCat, p1, p2, p3, setor.entryId, ambil.linkedEntryId];
      const all = await readEverything(reader, month, pribadiIds);
      const blob = JSON.stringify(all);

      for (const kanari of [KANARI_DESC, KANARI_DOMPET, String(KANARI_RP), '7.777.777']) {
        expect(blob).not.toContain(kanari);
      }
      for (const id of [owner.pribadi.spaceId, ...pribadiIds]) expect(blob).not.toContain(id);
      expect(all.foreign).toEqual(pribadiIds.map(() => null));
      expect(all.foreignAccounts).toEqual(pribadiIds.map(() => []));

      // Kaki Bersama: dompet sendiri, tanpa dompet lawan, tanpa deskripsi, hanya catatan bersama.
      const masuk = must(all.entries.find((e) => e.id === setor.linkedEntryId));
      expect(masuk).toMatchObject({
        kind: 'space_transfer',
        direction: 'in',
        accountId: kas,
        accountName: 'Kas Rumah',
        amount: 1_250_000,
        sharedNote: 'Setoran Oktober',
      });
      const keluar = must(all.entries.find((e) => e.id === ambil.entryId));
      expect(keluar).toMatchObject({ kind: 'space_transfer', direction: 'out', amount: 300_000 });
      for (const leg of [masuk, keluar]) {
        expect(leg).not.toHaveProperty('counterAccountId');
        expect(leg).not.toHaveProperty('counterAccountName');
        expect(leg).not.toHaveProperty('description');
      }
      expect(all.accounts.map((a) => a.id)).toEqual([kas]);
      expect(all.trash.map((t) => t.entry.id)).toEqual([voided]);
      expect(all.today).toEqual({ hasExpense: true, noSpendMarked: false });
      expect(all.entries.length).toBeGreaterThanOrEqual(4);
    }

    it('kanari Pribadi tidak terbaca dari Bersama', async () => {
      await canaryCase({ pribadi: nPribadi, bersama: nBersama }, fBersama);
    });

    it('kanari Pribadi tidak terbaca dari Bersama (arah sebaliknya)', async () => {
      await canaryCase({ pribadi: fPribadi, bersama: fBersama }, nBersama);
    });

    // RLS mengizinkan pembaca melihat Pribadi miliknya sendiri: hanya `space_id = ctx.spaceId`
    // di setiap kueri yang mencegahnya masuk ke rute Bersama.
    it('kanari Pribadi pembaca sendiri tidak terbaca dari Bersama', async () => {
      await canaryCase({ pribadi: fPribadi, bersama: fBersama }, fBersama);
    });
  });

  describe('transfer antar ruang lewat wrapper S7 (Review Focus 1)', () => {
    it('setor N Pribadi → Bersama: F membaca kaki masuk tanpa deskripsi dan tanpa dompet Pribadi', async () => {
      const month = await currentMonth();
      const bca = await wallet(nPribadi, 2_000_000, KANARI_DOMPET);
      const kas = await wallet(nBersama, 0, 'Kas Rumah');
      const setor = await createSpaceTransfer(nPribadi, {
        clientId: randomUUID(),
        fromAccountId: bca,
        toSpaceId: nBersama.spaceId,
        toAccountId: kas,
        amount: 1_250_000,
        fee: 6_500,
        description: KANARI_DESC,
        sharedNote: 'Setoran November',
        allowNegative: false,
      });

      const list = await listEntries(fBersama, { month });
      const masuk = must(list.find((e) => e.id === setor.linkedEntryId));
      const { createdAt, ...vm } = masuk;
      expect(createdAt).toMatch(WIB_TS);
      expect(vm).toEqual({
        id: setor.linkedEntryId,
        version: 1,
        kind: 'space_transfer',
        occurredOn: await dbToday(),
        createdBy: { id: ps.n.id, name: 'Novanda', initial: 'N' },
        accountId: kas,
        accountName: 'Kas Rumah',
        amount: 1_250_000,
        direction: 'in',
        spaceKind: 'shared',
        sharedNote: 'Setoran November',
      });

      const data = {
        list,
        perAccount: await listEntries(fBersama, { month, accountId: kas }),
        detail: await getEntry(fBersama, setor.linkedEntryId),
        foreign: await getEntry(fBersama, setor.entryId),
        foreignAccount: await listEntries(fBersama, { month, accountId: bca }),
      };
      const blob = JSON.stringify(data);
      for (const kanari of [KANARI_DESC, KANARI_DOMPET, bca, setor.entryId, nPribadi.spaceId]) {
        expect(blob).not.toContain(kanari);
      }
      // Biaya hanya di kaki Pribadi: tidak ada nominal biaya di Bersama.
      expect(memuatNominal(data, 6_500)).toBe(false);

      // Sisi Pribadi N: kaki keluar membawa deskripsi, tanpa catatan Bersama.
      const keluar = must(
        (await listEntries(nPribadi, { month })).find((e) => e.id === setor.entryId),
      );
      expect(keluar).toMatchObject({
        kind: 'space_transfer',
        direction: 'out',
        accountId: bca,
        description: KANARI_DESC,
      });
      expect(keluar).not.toHaveProperty('sharedNote');
    });
  });

  describe('batas hari WIB (Review Focus 3)', () => {
    /** Pool `dompetku_web` dengan jam DB tiruan (`app.now_override`, aktif bila env = test). */
    function clockPools(at: string): Pools {
      const u = new URL(must(process.env.TEST_DATABASE_URL));
      u.searchParams.set('options', `-c app.now_override=${at}`);
      return createPools(u.toString());
    }

    it('31 Okt 23:30 WIB masuk Oktober [T13]', async () => {
      const prev = await h.admin.query<{ value: string }>(
        `select value from app.settings where key = 'env'`,
      );
      let okt: Pools | undefined;
      let nov: Pools | undefined;
      // Semua persiapan di dalam try: env selalu kembali ke nilai semula walau persiapan gagal.
      try {
        await h.admin.query(`update app.settings set value = 'test' where key = 'env'`);
        okt = clockPools('2026-10-31T23:30:00+07:00');
        // 00:05 WIB 1 Nov = 17:05 UTC 31 Okt: zona UTC akan salah menaruhnya di Oktober.
        nov = clockPools('2026-11-01T00:05:00+07:00');
        const at = (pools: Pools) => ({ ...nPribadi, pools });
        const today = (pools: Pools) =>
          withUser(pools.app, ps.n.id, async (c) => {
            const { rows } = await c.query<{ d: string }>('select app.today() as d');
            return rows[0]?.d;
          });
        expect(await today(okt)).toBe('2026-10-31');
        expect(await today(nov)).toBe('2026-11-01');

        const acc = await wallet(at(okt), 100_000);
        const oktId = await expense(at(okt), acc, 25_000);
        expect(await todayStatus(at(okt))).toEqual({ hasExpense: true, noSpendMarked: false });
        const novId = await expense(at(nov), acc, 40_000);

        const oktober = await listEntries(nPribadi, { month: '2026-10' });
        const november = await listEntries(nPribadi, { month: '2026-11' });
        expect(oktober.map((e) => e.id)).toContain(oktId);
        expect(oktober.map((e) => e.id)).not.toContain(novId);
        expect(november.map((e) => e.id)).toEqual([novId]);
        expect(must(oktober.find((e) => e.id === oktId)).occurredOn).toBe('2026-10-31');
        expect(must(november[0]).occurredOn).toBe('2026-11-01');
        expect((await monthSummary(nPribadi, '2026-10')).pengeluaran).toBe(25_000);
        expect((await monthSummary(nPribadi, '2026-11')).pengeluaran).toBe(40_000);
      } finally {
        await h.admin.query(`update app.settings set value = $1 where key = 'env'`, [
          prev.rows[0]?.value ?? 'prod',
        ]);
        await Promise.all([okt, nov].flatMap((p) => (p ? [p.app.end(), p.auth.end()] : [])));
      }
    });
  });

  describe('dompet dan saldo', () => {
    it('saldo listAccounts = Σ lines setelah create/void/restore', async () => {
      const a = await wallet(nPribadi, 500_000, 'BCA');
      const b = await wallet(nPribadi, 0, 'Dana');
      await wallet(fPribadi, 900_000, 'BCA F');
      const check = async (expected: Record<string, number>) => {
        const list = await listAccounts(nPribadi);
        expect(list.map((x) => x.id).sort()).toEqual([a, b].sort());
        for (const acc of list) {
          expect(acc.balance).toBe(await balance(acc.id));
          expect(acc.balance).toBe(expected[acc.id]);
        }
      };
      await check({ [a]: 500_000, [b]: 0 });

      const e1 = await expense(nPribadi, a, 120_000);
      await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: b,
        kind: 'income',
        amount: 50_000,
        categoryId: await categoryOf(nPribadi.spaceId, 'income'),
      });
      await createTransfer(nPribadi, {
        clientId: randomUUID(),
        fromAccountId: a,
        toAccountId: b,
        amount: 30_000,
      });
      await check({ [a]: 350_000, [b]: 80_000 });

      await voidEntry(nPribadi, { clientId: randomUUID(), entryId: e1, expectedVersion: 1 });
      await check({ [a]: 470_000, [b]: 80_000 });

      await restoreEntry(nPribadi, { clientId: randomUUID(), entryId: e1, expectedVersion: 2 });
      await check({ [a]: 350_000, [b]: 80_000 });

      const list = await listAccounts(nPribadi);
      expect(must(list.find((x) => x.id === a))).toEqual({
        id: a,
        name: 'BCA',
        pocket: 'operasional',
        walletType: 'bank',
        openedOn: await dbToday(),
        archived: false,
        balance: 350_000,
      });
    });

    it('dompet terarsip bersaldo 0 tidak tampil', async () => {
      const a = await wallet(nPribadi, 10_000, 'BCA');
      const old = await wallet(nPribadi, 0, 'Lama');
      await withUser(h.pools.app, ps.n.id, (c) =>
        c.query('select api.archive_account(p_account_id => $1)', [old]),
      );
      expect((await listAccounts(nPribadi)).map((x) => x.id)).toEqual([a]);
    });

    it('safeToSpend = saldo operasional ruang', async () => {
      await wallet(nPribadi, 400_000, 'BCA');
      await wallet(nBersama, 1_000_000, 'Kas Rumah');
      const s = await safeToSpend(nPribadi);
      expect(s).toEqual({
        operasional: 400_000,
        billsUntilEom: 0,
        budgetWajibRemaining: 0,
        aman: 400_000,
        until: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
        daysLeft: expect.any(Number) as number,
        perDay: expect.any(Number) as number,
      });
      // Gajian kosong (bootstrap): sampai akhir bulan kalender; per hari floor (SQL).
      expect(s.daysLeft).toBeGreaterThanOrEqual(1);
      expect(s.perDay).toBe(Math.floor(400_000 / s.daysLeft));
    });
  });

  describe('entri', () => {
    it('listEntries: hidup saja, terbaru di atas, bentuk VM, filter dompet', async () => {
      const month = await currentMonth();
      const a = await wallet(nPribadi, 500_000, 'BCA');
      const b = await wallet(nPribadi, 0, 'Dana');
      const catId = await categoryOf(nPribadi.spaceId, 'expense');
      const e1 = await expense(nPribadi, a, 35_000, {
        description: 'makan siang',
        categoryId: catId,
      });
      const gone = await expense(nPribadi, a, 5_000);
      await voidEntry(nPribadi, { clientId: randomUUID(), entryId: gone, expectedVersion: 1 });
      const { entryId: t1 } = await createTransfer(nPribadi, {
        clientId: randomUUID(),
        fromAccountId: a,
        toAccountId: b,
        amount: 20_000,
      });

      const list = await listEntries(nPribadi, { month });
      expect(list.map((e) => e.id).slice(0, 2)).toEqual([t1, e1]);
      expect(list.map((e) => e.id)).not.toContain(gone);
      expect(list.map((e) => e.kind)).toEqual(['transfer', 'expense', 'opening_balance']);

      const { createdAt, ...ex } = must(list.find((e) => e.id === e1));
      expect(createdAt).toMatch(WIB_TS);
      expect(ex).toEqual({
        id: e1,
        version: 1,
        kind: 'expense',
        occurredOn: await dbToday(),
        createdBy: { id: ps.n.id, name: 'Novanda', initial: 'N' },
        accountId: a,
        accountName: 'BCA',
        amount: 35_000,
        categoryId: catId,
        categoryName: 'Makan Siang & Minum',
        categoryIcon: 'ForkKnife',
        description: 'makan siang',
      });
      expect(must(list.find((e) => e.id === t1))).toMatchObject({
        kind: 'transfer',
        accountId: a,
        accountName: 'BCA',
        counterAccountId: b,
        counterAccountName: 'Dana',
        amount: 20_000,
      });

      expect((await listEntries(nPribadi, { month, accountId: b })).map((e) => e.id)).toEqual([t1]);
      expect((await recentEntries(nPribadi, 2)).map((e) => e.id)).toEqual([t1, e1]);
      expect(await listEntries(nPribadi, { month: '2000-01' })).toEqual([]);
    });

    it('adjustment: nominal absolut, arah dari tanda (turun = out, naik = in)', async () => {
      const a = await wallet(nPribadi, 100_000, 'BCA');
      const turun = await reconcile(ps.n.id, a, 80_000);
      const naik = await reconcile(ps.n.id, a, 95_000);
      expect(await balance(a)).toBe(95_000);

      const list = await listEntries(nPribadi, { month: await currentMonth() });
      expect(must(list.find((e) => e.id === turun))).toMatchObject({
        kind: 'adjustment',
        amount: 20_000,
        direction: 'out',
      });
      expect(must(list.find((e) => e.id === naik))).toMatchObject({
        kind: 'adjustment',
        amount: 15_000,
        direction: 'in',
      });
      expect(must(await getEntry(nPribadi, turun)).entry.direction).toBe('out');
      // Jenis lain di luar space_transfer/adjustment tidak membawa arah.
      for (const e of list.filter((x) => x.kind !== 'adjustment')) {
        expect(e).not.toHaveProperty('direction');
      }
    });

    it('reimburse talangan tampil sebagai kind reimbursement (pemasukan ke dompet)', async () => {
      const month = await currentMonth();
      const a = await wallet(nPribadi, 1_000_000, 'BCA');
      const t = await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: a,
        kind: 'expense',
        amount: 300_000,
        categoryId: await categoryOf(nPribadi.spaceId, 'expense'),
        description: 'hotel dinas',
        reimbursable: true,
      });
      const r = await createReimbursement(nPribadi, {
        clientId: randomUUID(),
        entryId: t.entryId,
        accountId: a,
        amount: 100_000,
        description: 'transfer kantor',
      });

      const list = await listEntries(nPribadi, { month });
      expect(must(list.find((e) => e.id === t.entryId))).toMatchObject({
        kind: 'expense',
        reimbursable: true,
      });
      const { createdAt, ...vm } = must(list.find((e) => e.id === r.entryId));
      expect(createdAt).toMatch(WIB_TS);
      expect(vm).toEqual({
        id: r.entryId,
        version: 1,
        kind: 'reimbursement',
        occurredOn: await dbToday(),
        createdBy: { id: ps.n.id, name: 'Novanda', initial: 'N' },
        accountId: a,
        accountName: 'BCA',
        amount: 100_000,
        description: 'transfer kantor',
        reimbursesEntryId: t.entryId,
      });
      expect(must(await getEntry(nPribadi, r.entryId)).entry.kind).toBe('reimbursement');
      expect((await accountEntries(nPribadi, a, 10)).entries.map((e) => e.kind)).toEqual([
        'reimbursement',
        'expense',
      ]);
    });

    it('getEntry entri batal tetap terbaca dengan voidedAt', async () => {
      const kas = await wallet(nBersama, 200_000, 'Kas Rumah');
      const id = await expense(fBersama, kas, 45_000, { description: 'Gas' });
      await voidEntry(nBersama, { clientId: randomUUID(), entryId: id, expectedVersion: 1 });

      const got = must(await getEntry(nBersama, id));
      expect(got.entry).toMatchObject({
        id,
        version: 2,
        amount: 45_000,
        createdBy: { id: f.id, name: 'Farida', initial: 'F' },
      });
      expect(got.entry.voidedAt).toMatch(WIB_TS);
      for (const step of got.history) expect(step.at).toMatch(WIB_TS);
      expect(
        got.history.map(({ version, op, by, amount }) => ({ version, op, by, amount })),
      ).toEqual([
        { version: 1, op: 'create', by: { name: 'Farida', initial: 'F' }, amount: 45_000 },
        { version: 2, op: 'void', by: { name: 'Novanda', initial: 'N' }, amount: 45_000 },
      ]);
      expect(await getEntry(nBersama, randomUUID())).toBeNull();
      expect(await getEntry(nBersama, 'bukan-uuid')).toBeNull();
    });

    it('trashList hanya entri batal ≤ 90 hari, terbaru dulu', async () => {
      const a = await wallet(nPribadi, 500_000);
      const mk = async () => {
        const id = await expense(nPribadi, a, 10_000);
        await voidEntry(nPribadi, { clientId: randomUUID(), entryId: id, expectedVersion: 1 });
        return id;
      };
      const lewat = await mk();
      const lama = await mk();
      const baru = await mk();
      const live = await expense(nPribadi, a, 1_000);
      const setVoided = (id: string, ago: string) =>
        h.admin.query(`update app.entries set voided_at = now() - $2::interval where id = $1`, [
          id,
          ago,
        ]);
      await setVoided(lewat, '90 days 1 minute');
      await setVoided(lama, '10 days');
      await setVoided(baru, '1 day');

      const trash = await trashList(nPribadi);
      expect(trash.map((t) => t.entry.id)).toEqual([baru, lama]);
      expect(trash.map((t) => t.entry.id)).not.toContain(live);
      for (const t of trash) {
        expect(t.purgeAfter).toMatch(WIB_TS);
        expect(t.entry.voidedAt).toMatch(WIB_TS);
        expect(t.entry.amount).toBe(10_000);
      }
      expect(await trashList(fPribadi)).toEqual([]);
    });
  });

  describe('Beranda', () => {
    it('todayStatus: hanya pengeluaran hidup hari ini yang dihitung; markNoSpendDay per ruang', async () => {
      expect(await todayStatus(nBersama)).toEqual({ hasExpense: false, noSpendMarked: false });
      await markNoSpendDay(nBersama);
      expect(await todayStatus(nBersama)).toEqual({ hasExpense: false, noSpendMarked: true });
      expect(await todayStatus(fBersama)).toEqual({ hasExpense: false, noSpendMarked: true });
      // Ruang lain tidak ikut tertandai.
      expect(await todayStatus(nPribadi)).toEqual({ hasExpense: false, noSpendMarked: false });

      // Saldo awal dan cocokkan saldo bukan "mencatat hari ini".
      const kas = await wallet(nBersama, 100_000, 'Kas Rumah');
      await reconcile(ps.n.id, kas, 90_000);
      expect(await todayStatus(nBersama)).toEqual({ hasExpense: false, noSpendMarked: true });

      // Pemasukan dan transfer bukan pengeluaran: tombol tetap boleh tampil (ruling review akhir).
      await createEntry(nBersama, {
        clientId: randomUUID(),
        accountId: kas,
        kind: 'income',
        amount: 50_000,
        categoryId: await categoryOf(nBersama.spaceId, 'income'),
      });
      const kas2 = await wallet(nBersama, 0, 'Kas Cadangan');
      await createTransfer(nBersama, {
        clientId: randomUUID(),
        fromAccountId: kas,
        toAccountId: kas2,
        amount: 10_000,
      });
      expect(await todayStatus(nBersama)).toEqual({ hasExpense: false, noSpendMarked: true });

      // Pengeluaran hidup hari ini: hasExpense, walau hari sudah ditandai (baris tidak dihapus).
      const belanja = await expense(nBersama, kas, 20_000);
      expect(await todayStatus(nBersama)).toEqual({ hasExpense: true, noSpendMarked: true });
      // Pengeluaran dibatalkan tidak dihitung.
      await voidEntry(nBersama, { clientId: randomUUID(), entryId: belanja, expectedVersion: 1 });
      expect(await todayStatus(nBersama)).toEqual({ hasExpense: false, noSpendMarked: true });
    });

    it('monthSummary memetakan api.month_summary', async () => {
      const month = await currentMonth();
      const a = await wallet(nPribadi, 500_000, 'BCA');
      const b = await wallet(nPribadi, 0, 'Dana');
      await expense(nPribadi, a, 70_000);
      await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: a,
        kind: 'income',
        amount: 200_000,
        categoryId: await categoryOf(nPribadi.spaceId, 'income'),
      });
      await createTransfer(nPribadi, {
        clientId: randomUUID(),
        fromAccountId: a,
        toAccountId: b,
        amount: 15_000,
      });
      expect(await monthSummary(nPribadi, month)).toEqual({
        pemasukan: 200_000,
        pengeluaran: 70_000,
        selisih: 130_000,
        transfer: 15_000,
      });
      await expect(monthSummary(nPribadi, '2026-13')).rejects.toThrow();
    });

    it('suggestCategories sama dengan api.suggest_categories langsung (urutan id)', async () => {
      const a = await wallet(nPribadi, 5_000_000);
      const cats = await categoriesOf(nPribadi.spaceId, 'expense');
      // Riwayat berbeda per kategori agar urutan tidak sekadar urutan nama.
      for (const [i, n] of [
        [3, 3],
        [5, 2],
        [1, 1],
      ] as const) {
        for (let k = 0; k < n; k++) {
          await expense(nPribadi, a, 20_000 * (k + 1), { categoryId: must(cats[i]) });
        }
      }
      const direct = (
        type: string,
        hour: number | null,
        amount: number | null,
        description: string | null,
      ) =>
        withUser(h.pools.app, ps.n.id, async (c) => {
          const { rows } = await c.query<{ category_id: string }>(
            `select category_id from api.suggest_categories(
               p_space_id => $1, p_type => $2::app.category_type, p_hour => $3::smallint,
               p_amount => $4::bigint, p_description => $5)`,
            [nPribadi.spaceId, type, hour, amount, description],
          );
          return rows.map((r) => r.category_id);
        });

      const got = await suggestCategories(nPribadi, {
        type: 'expense',
        hour: 12,
        amount: 25_000,
        description: 'isi bensin',
      });
      expect(got).toHaveLength(6);
      expect(got).toEqual(await direct('expense', 12, 25_000, 'isi bensin'));
      expect(await suggestCategories(nPribadi, { type: 'income' })).toEqual(
        await direct('income', null, null, null),
      );
    });
  });
});
