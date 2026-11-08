import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPools, withUser } from '../../db';
import { loadBeranda } from '../beranda';
import { loadDetail } from '../detail';
import { loadLaporan } from '../laporan';
import { toLedgerError } from '../errors';
import {
  getEntry,
  hasExpense,
  listAccounts,
  listCategories,
  listEntries,
  loadRuangShell,
  monthSummary,
  recentEntries,
  safeToSpend,
  todayStatus,
  trashList,
} from '../read';
import { loadRencana } from '../rencana';
import { loadSampah } from '../sampah';
import { resolveSpace } from '../space';
import { loadTransaksi } from '../transaksi';
import { createAccount, createEntry, createTransfer, voidEntry, type LedgerCtx } from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * Pool habis atau DB tak terjangkau: `connect()` gagal sesudah `connectionTimeoutMillis`
 * (`timeout exceeded when trying to connect`) dan dipetakan ke `network`, bukan menggantung.
 */

function databaseUrl(): string {
  const v = process.env.TEST_DATABASE_URL;
  if (!v) throw new Error('TEST_DATABASE_URL wajib diisi untuk tes integrasi');
  return v;
}

async function failure(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('seharusnya gagal');
    },
    (e: unknown) => e,
  );
}

describe('pool habis = network', () => {
  it('createPools memasang connectionTimeoutMillis 5000', async () => {
    const pools = createPools(databaseUrl());
    try {
      for (const pool of [pools.app, pools.auth]) {
        expect(
          (pool as unknown as { options: pg.PoolConfig }).options.connectionTimeoutMillis,
        ).toBe(5000);
      }
    } finally {
      await Promise.all([pools.app.end(), pools.auth.end()]);
    }
  });

  it('koneksi tidak didapat sebelum batas waktu = network', async () => {
    // Pool kecil sendiri agar pool bersama tidak terganggu.
    const pool = new pg.Pool({
      connectionString: databaseUrl(),
      max: 1,
      connectionTimeoutMillis: 200,
    });
    const held = await pool.connect();
    try {
      const err = await failure(
        withUser(pool, randomUUID(), () => Promise.resolve('tidak sampai')),
      );
      expect(toLedgerError(err)).toEqual({ code: 'network' });
    } finally {
      held.release();
      await pool.end();
    }
  });
});

/**
 * Tekanan pool (S7 Task 7): satu muat page `[ruang]` membaca dalam satu transaksi `withLedger`,
 * bukan satu transaksi per kueri secara paralel. Puncak koneksi bersamaan diukur dari event
 * `acquire`/`release` pool domain (`createPools`, `max: 5`).
 */
describe('satu transaksi baca per page', () => {
  const h = createLedgerHarness();
  let pribadi: BerandaCtx;
  let bersama: BerandaCtx;
  let voidedId: string;
  let expenseId: string;

  afterAll(async () => {
    await h.close();
  });

  type BerandaCtx = LedgerCtx & { kind: 'personal' | 'shared' };

  async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<BerandaCtx> {
    const { spaceId, kind } = await resolveSpace(h.pools, p.id, ruang);
    return { pools: h.pools, userId: p.id, spaceId, kind };
  }

  /** Puncak koneksi pool domain yang dipinjam bersamaan selama `fn`. */
  async function peakDuring<T>(fn: () => Promise<T>): Promise<{ peak: number; result: T }> {
    let now = 0;
    let peak = 0;
    const onAcquire = () => {
      now += 1;
      peak = Math.max(peak, now);
    };
    const onRelease = () => {
      now -= 1;
    };
    h.pools.app.on('acquire', onAcquire);
    h.pools.app.on('release', onRelease);
    try {
      const result = await fn();
      return { peak, result };
    } finally {
      h.pools.app.off('acquire', onAcquire);
      h.pools.app.off('release', onRelease);
    }
  }

  beforeAll(async () => {
    await resetLedger(h);
    const { n } = await seedPersonas(h, { farida: 'diundang' });
    pribadi = await ctxOf(n, 'pribadi');
    bersama = await ctxOf(n, 'bersama');
    const { accountId: bca } = await createAccount(pribadi, {
      clientId: randomUUID(),
      name: 'BCA',
      pocket: 'operasional',
      walletType: 'bank',
      openingBalance: 3_000_000,
    });
    const { accountId: tabungan } = await createAccount(pribadi, {
      clientId: randomUUID(),
      name: 'Tabungan',
      pocket: 'tabungan',
      walletType: 'bank',
      openingBalance: 1_000_000,
    });
    const { rows } = await h.admin.query<{ id: string }>(
      `select id from app.categories
        where space_id = $1 and type = 'expense' and parent_id is null
        order by sort_order limit 1`,
      [pribadi.spaceId],
    );
    const categoryId = rows[0]?.id;
    if (!categoryId) throw new Error('kategori awal tidak ada');
    ({ entryId: expenseId } = await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: bca,
      kind: 'expense',
      amount: 45_000,
      categoryId,
      description: 'makan siang',
    }));
    await createTransfer(pribadi, {
      clientId: randomUUID(),
      fromAccountId: bca,
      toAccountId: tabungan,
      amount: 200_000,
    });
    const voided = await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: bca,
      kind: 'expense',
      amount: 12_000,
      categoryId,
    });
    voidedId = voided.entryId;
    await voidEntry(pribadi, {
      clientId: randomUUID(),
      entryId: voided.entryId,
      expectedVersion: voided.version,
    });
    await createAccount(bersama, {
      clientId: randomUUID(),
      name: 'Kas Rumah',
      pocket: 'operasional',
      walletType: 'cash',
      openingBalance: 500_000,
    });
  });

  /** Bentuk lama `loadBeranda`: setiap bacaan di transaksinya sendiri, paralel. */
  async function berandaLama(ctx: BerandaCtx) {
    const [safe, today, accounts, expense, recent, invite] = await Promise.all([
      safeToSpend(ctx),
      todayStatus(ctx),
      listAccounts(ctx),
      hasExpense(ctx),
      recentEntries(ctx, 5),
      ctx.kind === 'personal'
        ? withUser(ctx.pools.app, ctx.userId, async (c) => {
            const { rows } = await c.query<{ role: string; members: number }>(
              `select m.role::text as role,
                      (select count(*) from app.space_roster(s.id))::int as members
                 from app.spaces s
                 join app.space_members m
                   on m.space_id = s.id and m.user_id = app.current_user_id()
                where s.kind = 'shared'
                limit 1`,
            );
            const r = rows[0];
            return r?.role === 'owner' && r.members < 2;
          })
        : false,
    ]);
    return {
      safe,
      today,
      hasOperasional: accounts.some((a) => a.pocket === 'operasional' && !a.archived),
      hasExpense: expense,
      recent,
      invite,
    };
  }

  it('loadBeranda memakai paling banyak 1 koneksi dan hasilnya sama dengan bentuk lama', async () => {
    for (const ctx of [pribadi, bersama]) {
      const { peak, result } = await peakDuring(() => loadBeranda(ctx));
      expect(peak).toBe(1);
      // `bersama` (Task 13) dan bacaan S9 (periode, status, kartu Tagihan/Anggaran) tidak ada di
      // bentuk lama; isinya diuji di beranda.int.test dan rencana.int.test.
      const { status, reason, hasObligations, ...safe } = result.safe;
      expect([status, reason, hasObligations]).toEqual(['aman', null, false]);
      expect({
        ...result,
        safe,
        bersama: undefined,
        period: undefined,
        billsDue: undefined,
        budgetsNear: undefined,
      }).toEqual(await berandaLama(ctx));
    }
    const p = await loadBeranda(pribadi);
    expect(p.recent.map((e) => e.kind)).toEqual([
      'transfer',
      'expense',
      'opening_balance',
      'opening_balance',
    ]);
    expect(p).toMatchObject({
      safe: { operasional: 3_000_000 - 45_000 - 200_000 },
      today: { hasExpense: true, noSpendMarked: false },
      hasOperasional: true,
      hasExpense: true,
      invite: true,
    });
  });

  it('dompet dari layout (opsi `accounts`): Beranda + layout = paling banyak 2 koneksi', async () => {
    const { peak, result } = await peakDuring(async () => {
      const shell = loadRuangShell(pribadi);
      const [s, data] = await Promise.all([
        shell,
        loadBeranda(pribadi, { accounts: shell.then((x) => x.accounts) }),
      ]);
      return { s, data };
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(result.data).toEqual(await loadBeranda(pribadi));
    expect(result.s).toEqual({
      accounts: await listAccounts(pribadi),
      categories: await listCategories(pribadi),
    });
  });

  it('tiga muat Beranda paralel (pool max 5): tanpa galat, puncak ≤ 3', async () => {
    const { peak, result } = await peakDuring(() =>
      Promise.allSettled([loadBeranda(pribadi), loadBeranda(bersama), loadBeranda(pribadi)]),
    );
    expect(result.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('Transaksi, Detail, Sampah, dan opsi layout: masing-masing satu koneksi, hasil sama', async () => {
    const month = (await loadBeranda(pribadi)).recent[0]?.occurredOn.slice(0, 7);
    if (!month) throw new Error('bulan tidak ada');

    const t = await peakDuring(() => loadTransaksi(pribadi, month));
    expect(t.peak).toBe(1);
    expect(t.result.entries).toEqual(await listEntries(pribadi, { month }));
    expect(t.result.summary).toEqual(await monthSummary(pribadi, month));
    expect(t.result).toMatchObject({ hasAny: true, firstMonth: month });

    const d = await peakDuring(() => loadDetail(pribadi, expenseId));
    expect(d.peak).toBe(1);
    expect(d.result).toEqual({
      ...(await getEntry(pribadi, expenseId)),
      accounts: await listAccounts(pribadi),
      categories: await listCategories(pribadi),
      restoreClosed: false,
      spaceCount: 2,
      talangan: null,
    });
    const tidakAda = await peakDuring(() => loadDetail(pribadi, randomUUID()));
    expect(tidakAda).toEqual({ peak: 1, result: null });

    const s = await peakDuring(() => loadSampah(pribadi));
    expect(s.peak).toBe(1);
    expect(s.result).toEqual({
      items: await trashList(pribadi),
      accounts: await listAccounts(pribadi),
    });
    expect(s.result.items.map((x) => x.entry.id)).toEqual([voidedId]);

    const shell = await peakDuring(() => loadRuangShell(bersama));
    expect(shell.peak).toBe(1);
    expect(shell.result.accounts.map((a) => a.name)).toEqual(['Kas Rumah']);
  });

  it('S9: Rencana dan Laporan satu koneksi; Rencana + layout ≤ 2', async () => {
    for (const ctx of [pribadi, bersama]) {
      const r = await peakDuring(() => loadRencana(ctx));
      expect(r.peak).toBe(1);
      const l = await peakDuring(() => loadLaporan(ctx));
      expect(l.peak).toBe(1);
      const both = await peakDuring(async () => {
        const shell = loadRuangShell(ctx);
        const [, data] = await Promise.all([shell, loadRencana(ctx, { shell })]);
        return data;
      });
      expect(both.peak).toBeLessThanOrEqual(2);
      expect(both.result).toEqual(r.result);
    }
  });
});

/**
 * S8: Beranda Bersama dua anggota menambah feed, Kontribusi, dan roster ke transaksi baca yang
 * sama (Global Constraints S8): tetap satu koneksi sendiri, ≤ 2 bersama opsi layout.
 */
describe('Beranda Bersama dua anggota: feed dan Kontribusi di transaksi yang sama', () => {
  const h = createLedgerHarness();
  let bersama: LedgerCtx & { kind: 'personal' | 'shared' };

  afterAll(async () => {
    await h.close();
  });

  async function peakDuring<T>(fn: () => Promise<T>): Promise<{ peak: number; result: T }> {
    let now = 0;
    let peak = 0;
    const onAcquire = () => {
      now += 1;
      peak = Math.max(peak, now);
    };
    const onRelease = () => {
      now -= 1;
    };
    h.pools.app.on('acquire', onAcquire);
    h.pools.app.on('release', onRelease);
    try {
      const result = await fn();
      return { peak, result };
    } finally {
      h.pools.app.off('acquire', onAcquire);
      h.pools.app.off('release', onRelease);
    }
  }

  beforeAll(async () => {
    await resetLedger(h);
    const { n, f } = await seedPersonas(h, { farida: 'bergabung' });
    if (!f) throw new Error('Farida tidak ada');
    const { spaceId, kind } = await resolveSpace(h.pools, n.id, 'bersama');
    bersama = { pools: h.pools, userId: n.id, spaceId, kind };
    const { accountId } = await createAccount(bersama, {
      clientId: randomUUID(),
      name: 'Kas Rumah',
      pocket: 'operasional',
      walletType: 'cash',
      openingBalance: 500_000,
    });
    const { rows } = await h.admin.query<{ id: string }>(
      `select id from app.categories
        where space_id = $1 and type = 'expense' and parent_id is null
        order by sort_order limit 1`,
      [spaceId],
    );
    const categoryId = rows[0]?.id;
    if (!categoryId) throw new Error('kategori awal tidak ada');
    await createEntry(
      { ...bersama, userId: f.id },
      { clientId: randomUUID(), accountId, kind: 'expense', amount: 25_000, categoryId },
    );
  });

  it('loadBeranda sendiri = 1 koneksi; dengan opsi layout ≤ 2', async () => {
    const alone = await peakDuring(() => loadBeranda(bersama));
    expect(alone.peak).toBe(1);
    const b = alone.result.bersama;
    expect(b?.members).toBe(2);
    expect(Array.isArray(b?.activity) && b.activity.length).toBe(1);
    expect(b?.contributions).toMatchObject({ allZero: true });

    const withShell = await peakDuring(async () => {
      const shell = loadRuangShell(bersama);
      const [, data] = await Promise.all([
        shell,
        loadBeranda(bersama, { accounts: shell.then((x) => x.accounts) }),
      ]);
      return data;
    });
    expect(withShell.peak).toBeLessThanOrEqual(2);
    expect(withShell.result).toEqual(alone.result);
  });
});
