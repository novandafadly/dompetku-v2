import { randomUUID } from 'node:crypto';
import { formatRupiah, monthName } from '@dompetku/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBeranda } from '../beranda';
import {
  encodeCursor,
  loadAktivitas,
  parseCursor,
  sharedActivityTx,
  type Cursor,
} from '../bersama';
import { toLedgerError } from '../errors';
import { withLedger } from '../retry';
import { resolveSpace } from '../space';
import {
  createAccount,
  createEntry,
  createSpaceTransfer,
  moveEntryToSpace,
  restoreEntry,
  updateEntry,
  voidEntry,
  type LedgerCtx,
} from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * Loader feed Aktivitas dan Kontribusi Bersama (S8 Task 4) atas Postgres nyata, persona N
 * (pemilik), F (anggota lewat undangan), Luar (tanpa ruang). Review Focus S8 #1 (kanari Pribadi,
 * K1), #2 (urutan dan pelaku), #3 lewat loader, #4 (akses), dan kursor mikrodetik (R5).
 */

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

type Ctx = LedgerCtx & { kind: 'personal' | 'shared' };

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<Ctx> {
  const { spaceId, kind } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId, kind };
}

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('nilai tidak ada');
  return v;
}

async function categoryOf(ctx: LedgerCtx, type: 'income' | 'expense', n = 0): Promise<string> {
  const { rows } = await h.admin.query<{ id: string }>(
    `select id from app.categories
      where space_id = $1 and type = $2 and parent_id is null
      order by sort_order, id offset $3 limit 1`,
    [ctx.spaceId, type, n],
  );
  return must(rows[0]?.id);
}

async function categoryName(id: string): Promise<string> {
  const { rows } = await h.admin.query<{ name: string }>(
    'select name from app.categories where id = $1',
    [id],
  );
  return must(rows[0]?.name);
}

async function wallet(ctx: LedgerCtx, name: string, openingBalance: number): Promise<string> {
  const { accountId } = await createAccount(ctx, {
    clientId: randomUUID(),
    name,
    pocket: 'operasional',
    walletType: 'bank',
    openingBalance,
  });
  return accountId;
}

async function failure(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('seharusnya gagal');
    },
    (e: unknown) => e,
  );
}

/** Semua halaman `loadAktivitas` lewat jalur page (`encodeCursor` → `?sebelum=` → `parseCursor`). */
async function allPages(ctx: Ctx): Promise<{ keys: string[]; pages: number; cursors: Cursor[] }> {
  const keys: string[] = [];
  const cursors: Cursor[] = [];
  let before: Cursor | null = null;
  let pages = 0;
  for (;;) {
    const page = await loadAktivitas(ctx, { before });
    pages += 1;
    keys.push(...page.items.map((i) => i.key));
    if (!page.next) break;
    cursors.push(page.next);
    before = parseCursor(encodeCursor(page.next));
    expect(before).toEqual(page.next);
    if (pages > 20) throw new Error('paginasi tidak berhenti');
  }
  return { keys, pages, cursors };
}

/** Urutan oracle feed langsung dari tabel (superuser), tanpa saldo awal. */
async function oracleKeys(spaceId: string): Promise<string[]> {
  const { rows } = await h.admin.query<{ k: string }>(
    `select entry_id || ':' || version as k from app.entry_history
      where space_id = $1 and snapshot ->> 'kind' <> 'opening_balance'
      order by changed_at desc, entry_id desc, version desc`,
    [spaceId],
  );
  return rows.map((r) => r.k);
}

describe('feed dan Kontribusi Bersama, N dan F bergabung', () => {
  let n: Persona;
  let f: Persona;
  let luar: Persona;
  let nPribadi: Ctx;
  let fPribadi: Ctx;
  let nBersama: Ctx;
  let fBersama: Ctx;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung', luar: true });
    n = ps.n;
    f = must(ps.f);
    luar = must(ps.luar);
    nPribadi = await ctxOf(n, 'pribadi');
    fPribadi = await ctxOf(f, 'pribadi');
    nBersama = await ctxOf(n, 'bersama');
    fBersama = await ctxOf(f, 'bersama');
  });

  it('kanari Pribadi N/F, nama dompet, linkId, dan id kaki Pribadi tidak pernah keluar [B4]', async () => {
    const nAcc = await wallet(nPribadi, 'KANARI-DOMPET-N', 20_000_000);
    const fAcc = await wallet(fPribadi, 'KANARI-DOMPET-F', 20_000_000);
    const kas = await wallet(nBersama, 'KANARI-DOMPET-BERSAMA', 1_000_000);
    const nPriv = await createEntry(nPribadi, {
      clientId: randomUUID(),
      accountId: nAcc,
      kind: 'expense',
      amount: 7_777_777,
      categoryId: await categoryOf(nPribadi, 'expense'),
      description: 'KANARI-N-PRIBADI',
    });
    const fPriv = await createEntry(fPribadi, {
      clientId: randomUUID(),
      accountId: fAcc,
      kind: 'expense',
      amount: 6_666_666,
      categoryId: await categoryOf(fPribadi, 'expense'),
      description: 'KANARI-F-PRIBADI',
    });
    const setor = await createSpaceTransfer(nPribadi, {
      clientId: randomUUID(),
      fromAccountId: nAcc,
      toSpaceId: nBersama.spaceId,
      toAccountId: kas,
      amount: 500_000,
      fee: 0,
      description: 'KANARI-N-SETOR',
      sharedNote: 'catatan-bersama',
      allowNegative: false,
    });
    const ambil = await createSpaceTransfer(fBersama, {
      clientId: randomUUID(),
      fromAccountId: kas,
      toSpaceId: fPribadi.spaceId,
      toAccountId: fAcc,
      amount: 100_000,
      fee: 2_500,
      description: 'KANARI-F-AMBIL',
      allowNegative: false,
    });
    const belanja = await createEntry(nBersama, {
      clientId: randomUUID(),
      accountId: kas,
      kind: 'expense',
      amount: 85_000,
      categoryId: await categoryOf(nBersama, 'expense'),
      description: 'Belanja dapur',
    });
    const moved = await moveEntryToSpace(nBersama, {
      clientId: randomUUID(),
      entryId: belanja.entryId,
      expectedVersion: belanja.version,
      toSpaceId: nPribadi.spaceId,
      accountId: nAcc,
      categoryId: await categoryOf(nPribadi, 'expense'),
    });

    const pribadiOnly = [
      'KANARI-N-PRIBADI',
      'KANARI-F-PRIBADI',
      'KANARI-N-SETOR',
      'KANARI-F-AMBIL',
      'KANARI-DOMPET-N',
      'KANARI-DOMPET-F',
      '7777777',
      '6666666',
      nAcc,
      fAcc,
      nPriv.entryId,
      fPriv.entryId,
      setor.entryId,
      setor.linkId,
      ambil.linkedEntryId,
      ambil.linkId,
      moved.entryId,
      nPribadi.spaceId,
      fPribadi.spaceId,
    ];
    // K1: feed dan Kontribusi tanpa nama/id dompet mana pun, termasuk dompet Bersama.
    const walletAny = ['KANARI-DOMPET-BERSAMA', kas, 'accountId', 'accountName', 'linkId'];

    for (const [who, ctx] of [
      ['N', nBersama],
      ['F', fBersama],
    ] as const) {
      const beranda = await loadBeranda(ctx);
      const aktivitas = await loadAktivitas(ctx);
      const whole = JSON.stringify(beranda) + JSON.stringify(aktivitas);
      for (const k of pribadiOnly) expect(whole, `${who}: ${k}`).not.toContain(k);
      const feed = JSON.stringify(beranda.bersama) + JSON.stringify(aktivitas);
      for (const k of walletAny) expect(feed, `${who}: ${k}`).not.toContain(k);

      // Kontrol: peristiwa Bersama memang ada (kanari tidak lolos karena feed kosong).
      const texts = aktivitas.items.map((i) => `${i.actor.name} · ${i.text}`);
      expect(texts).toEqual([
        'Novanda · memindahkan transaksi ke ruang lain',
        'Novanda · mencatat pengeluaran Belanja dapur',
        'Farida · mengambil dari Bersama',
        'Novanda · menyetor ke Bersama (catatan-bersama)',
      ]);
      const pindah = must(aktivitas.items[0]);
      expect(pindah).toMatchObject({
        entryId: belanja.entryId,
        moved: true,
        amount: 85_000,
        href: `/bersama/transaksi/${belanja.entryId}`,
      });
      // Biaya ambil tidak ikut nominal (amount = |line main|).
      expect(aktivitas.items[2]?.amount).toBe(100_000);
      const activity = beranda.bersama?.activity;
      expect(Array.isArray(activity) && activity.map((i) => i.key)).toEqual(
        aktivitas.items.map((i) => i.key),
      );
    }
  });

  it('urutan dan pelaku: buat, ubah nominal, ubah kategori, batal, pulih [B8, B20]', async () => {
    const kas = await wallet(nBersama, 'Kas Rumah', 1_000_000);
    const makan = await categoryOf(nBersama, 'expense', 0);
    const lain = await categoryOf(nBersama, 'expense', 1);
    const base = {
      accountId: kas,
      occurredOn: null,
      description: 'Makan siang',
      reimbursable: false,
    };
    const e = await createEntry(nBersama, {
      clientId: randomUUID(),
      accountId: kas,
      kind: 'expense',
      amount: 50_000,
      categoryId: makan,
      description: 'Makan siang',
    });
    const v2 = await updateEntry(fBersama, {
      ...base,
      clientId: randomUUID(),
      entryId: e.entryId,
      expectedVersion: e.version,
      amount: 75_000,
      categoryId: makan,
    });
    const v3 = await updateEntry(nBersama, {
      ...base,
      clientId: randomUUID(),
      entryId: e.entryId,
      expectedVersion: v2.version,
      amount: 75_000,
      categoryId: lain,
    });
    const v4 = await voidEntry(fBersama, {
      clientId: randomUUID(),
      entryId: e.entryId,
      expectedVersion: v3.version,
    });
    await restoreEntry(nBersama, {
      clientId: randomUUID(),
      entryId: e.entryId,
      expectedVersion: v4.version,
    });

    const [nMakan, nLain] = [await categoryName(makan), await categoryName(lain)];
    for (const ctx of [nBersama, fBersama]) {
      const { items, next, partner } = await loadAktivitas(ctx);
      expect(next).toBeNull();
      expect(partner).toEqual(
        ctx === nBersama ? { name: 'Farida', initial: 'F' } : { name: 'Novanda', initial: 'N' },
      );
      expect(
        items.map((i) => ({
          actor: i.actor.name,
          role: i.actor.role,
          text: i.text,
          change: i.change,
          srText: i.srText,
          amount: i.amount,
          beforeAmount: i.beforeAmount,
          backdate: i.backdate,
          key: i.key,
        })),
      ).toEqual([
        {
          actor: 'Novanda',
          role: 'owner',
          text: 'memulihkan pengeluaran Makan siang',
          change: [],
          srText: undefined,
          amount: 75_000,
          beforeAmount: null,
          backdate: null,
          key: `${e.entryId}:5`,
        },
        {
          actor: 'Farida',
          role: 'member',
          text: 'membatalkan pengeluaran Makan siang',
          change: [],
          srText: undefined,
          amount: 75_000,
          beforeAmount: null,
          backdate: null,
          key: `${e.entryId}:4`,
        },
        {
          actor: 'Novanda',
          role: 'owner',
          text: 'mengubah Makan siang',
          change: [`${nMakan} → ${nLain}`],
          srText: `dari ${nMakan} menjadi ${nLain}`,
          amount: 75_000,
          beforeAmount: null,
          backdate: null,
          key: `${e.entryId}:3`,
        },
        {
          actor: 'Farida',
          role: 'member',
          text: 'mengubah Makan siang',
          // Versi sebelumnya = versi 1 (bukan versi pertama secara kebetulan: lihat baris 3).
          change: [`${formatRupiah(50_000)} → ${formatRupiah(75_000)}`],
          srText: `dari ${formatRupiah(50_000)} menjadi ${formatRupiah(75_000)}`,
          amount: null,
          beforeAmount: 50_000,
          backdate: null,
          key: `${e.entryId}:2`,
        },
        {
          actor: 'Novanda',
          role: 'owner',
          text: 'mencatat pengeluaran Makan siang',
          change: [],
          srText: undefined,
          amount: 50_000,
          beforeAmount: null,
          backdate: null,
          key: `${e.entryId}:1`,
        },
      ]);
      for (const i of items) {
        expect(i.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
        expect(i.href).toBe(`/bersama/transaksi/${e.entryId}`);
      }
    }
    // Beranda: 5 terbaru = seluruh riwayat di atas, urutan sama.
    const b = await loadBeranda(fBersama);
    const activity = b.bersama?.activity;
    expect(Array.isArray(activity) && activity.map((i) => i.key)).toEqual(
      [5, 4, 3, 2, 1].map((v) => `${e.entryId}:${String(v)}`),
    );
  });

  it('Kontribusi lewat loader: per pencatat, biaya dan batal tidak dihitung, pemilik dulu [B3, B6]', async () => {
    const nAcc = await wallet(nPribadi, 'BCA N', 5_000_000);
    const fAcc = await wallet(fPribadi, 'BCA F', 5_000_000);
    const kas = await wallet(nBersama, 'Kas Rumah', 0);
    const setor = (ctx: Ctx, from: string, amount: number) =>
      createSpaceTransfer(ctx, {
        clientId: randomUUID(),
        fromAccountId: from,
        toSpaceId: nBersama.spaceId,
        toAccountId: kas,
        amount,
        fee: 0,
        allowNegative: false,
      });
    await setor(nPribadi, nAcc, 500_000);
    await setor(nPribadi, nAcc, 200_000);
    const batal = await setor(nPribadi, nAcc, 50_000);
    await voidEntry(nPribadi, {
      clientId: randomUUID(),
      entryId: batal.entryId,
      expectedVersion: 1,
    });
    await setor(fPribadi, fAcc, 300_000);
    await createSpaceTransfer(fBersama, {
      clientId: randomUUID(),
      fromAccountId: kas,
      toSpaceId: fPribadi.spaceId,
      toAccountId: fAcc,
      amount: 100_000,
      fee: 2_500,
      allowNegative: false,
    });
    // K4: pemasukan Bersama biasa (kategori apa pun) bukan kontribusi.
    await createEntry(fBersama, {
      clientId: randomUUID(),
      accountId: kas,
      kind: 'income',
      amount: 900_000,
      categoryId: await categoryOf(fBersama, 'income'),
    });

    const { rows } = await h.admin.query<{ today: string }>('select app.today()::text as today');
    const today = must(rows[0]?.today);
    for (const ctx of [nBersama, fBersama]) {
      const c = (await loadBeranda(ctx)).bersama?.contributions;
      expect(c).toEqual({
        period: {
          from: `${today.slice(0, 7)}-01`,
          to: expect.stringMatching(new RegExp(`^${today.slice(0, 7)}-(28|29|30|31)$`)) as string,
          label: monthName(today.slice(0, 7)),
        },
        rows: [
          {
            member: { id: n.id, name: 'Novanda', initial: 'N', role: 'owner' },
            setoran: 700_000,
            diambil: 0,
          },
          {
            member: { id: f.id, name: 'Farida', initial: 'F', role: 'member' },
            setoran: 300_000,
            diambil: 100_000,
          },
        ],
        allZero: false,
      });
    }
  });

  it('dua anggota tanpa peristiwa: feed kosong (bukan null), Kontribusi semua nol', async () => {
    for (const [ctx, isOwner, partner] of [
      [nBersama, true, 'Farida'],
      [fBersama, false, 'Novanda'],
    ] as const) {
      const b = must((await loadBeranda(ctx)).bersama);
      expect(b).toMatchObject({ members: 2, isOwner, empty: true, activity: [] });
      expect(b.partner?.name).toBe(partner);
      const c = b.contributions;
      if (c === null || c === 'error') throw new Error('Kontribusi tidak dimuat');
      expect(c.allZero).toBe(true);
      expect(c.rows.map((r) => [r.member.name, r.setoran, r.diambil])).toEqual([
        ['Novanda', 0, 0],
        ['Farida', 0, 0],
      ]);
      expect(await loadAktivitas(ctx)).toEqual({ items: [], next: null, partner: b.partner });
    }
  });

  it('Pribadi tidak memuat feed/Kontribusi; Pribadi bukan halaman Aktivitas', async () => {
    const p = await loadBeranda(nPribadi);
    expect(p.bersama).toBeNull();
    expect(JSON.stringify(p)).not.toMatch(/activity|contributions|partner/);
    expect(toLedgerError(await failure(loadAktivitas(nPribadi)))).toEqual({ code: 'not_found' });
    // Ruang Pribadi lewat fungsi DB langsung: 0 baris (bukan galat) untuk pemiliknya.
    const page = await withLedger(h.pools, n.id, nPribadi.spaceId, (c) =>
      sharedActivityTx(c, nPribadi, { limit: 10 }),
    );
    expect(page).toEqual({ items: [], next: null });
  });

  it('akses: Luar ke Bersama dan F ke Pribadi N = not_found', async () => {
    const asLuar = { ...nBersama, userId: luar.id };
    expect(toLedgerError(await failure(loadAktivitas(asLuar)))).toEqual({ code: 'not_found' });
    expect(toLedgerError(await failure(loadBeranda(asLuar)))).toEqual({ code: 'not_found' });
    expect(toLedgerError(await failure(resolveSpace(h.pools, luar.id, 'bersama')))).toEqual({
      code: 'not_found',
    });
    const fKeNPribadi = { ...nPribadi, userId: f.id, kind: 'shared' as const };
    expect(toLedgerError(await failure(loadAktivitas(fKeNPribadi)))).toEqual({
      code: 'not_found',
    });
  });

  it('parseCursor sampah = halaman pertama', async () => {
    const kas = await wallet(nBersama, 'Kas Rumah', 1_000_000);
    await createEntry(nBersama, {
      clientId: randomUUID(),
      accountId: kas,
      kind: 'expense',
      amount: 10_000,
      categoryId: await categoryOf(nBersama, 'expense'),
    });
    const first = await loadAktivitas(nBersama);
    expect(first.items).toHaveLength(1);
    const b64 = (s: string) => Buffer.from(s).toString('base64url');
    const junk = [
      undefined,
      '',
      'sampah',
      '%%%',
      'x'.repeat(500),
      b64('a|b|c'),
      // Milidetik saja (bentuk Date JS) ditolak: kursor wajib 6 digit pecahan (R5).
      b64(`2026-11-04T03:12:45.123Z|${randomUUID()}|1`),
      b64(`2026-02-30T03:12:45.123456Z|${randomUUID()}|1`),
      b64(`2026-11-04T03:12:45.123456Z|${randomUUID()}|0`),
      b64(`2026-11-04T03:12:45.123456Z|${randomUUID()}|1|x`),
    ];
    for (const s of junk) {
      expect(parseCursor(s)).toBeNull();
      expect(await loadAktivitas(nBersama, { before: parseCursor(s) })).toEqual(first);
    }
  });
});

describe('kursor mikrodetik (R5)', () => {
  let nBersama: Ctx;

  beforeAll(async () => {
    await resetLedger(h);
    const { n } = await seedPersonas(h, { farida: 'bergabung' });
    nBersama = await ctxOf(n, 'bersama');
    const kas = await wallet(nBersama, 'Kas Rumah', 1_000_000);
    const cat = await categoryOf(nBersama, 'expense');
    const entries: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { entryId } = await createEntry(nBersama, {
        clientId: randomUUID(),
        accountId: kas,
        kind: 'expense',
        amount: 1_000 + i,
        categoryId: cat,
      });
      entries.push(entryId);
    }
    // 45 peristiwa sintetis (superuser; riwayat append-only menerima insert) dalam SATU milidetik:
    // changed_at = T0 + floor(i / 2) µs, jadi ada seri persis dan beda mikrodetik di milidetik yang
    // sama. Kursor dari Date JS (milidetik) melompati sebagian baris ini.
    await h.admin.query(
      `with base as (
         select date_trunc('milliseconds', now()) + interval '1 hour' as t0)
       insert into app.entry_history (entry_id, space_id, version, op, snapshot, changed_by, changed_at)
       select h.entry_id, h.space_id, 1000 + g.i, 'update', h.snapshot, h.changed_by,
              base.t0 + (g.i / 2) * interval '1 microsecond'
         from generate_series(0, 44) as g(i)
         cross join base
         join app.entry_history h
           on h.entry_id = ($1::uuid[])[1 + g.i % 3] and h.version = 1`,
      [entries],
    );
  });

  it('halaman 30 lewat loadAktivitas: tanpa duplikat dan tanpa lompatan', async () => {
    const oracle = await oracleKeys(nBersama.spaceId);
    expect(oracle).toHaveLength(48);
    const { keys, pages, cursors } = await allPages(nBersama);
    expect(pages).toBe(2);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(oracle);
    // Kursor teks mikrodetik (bukan milidetik Date JS), di dalam milidetik sintetis yang sama.
    const at = must(cursors[0]).at;
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    expect(at.slice(-4, -1)).not.toBe('000');
    expect(new Date(at).toISOString()).not.toBe(at);
  });

  it('halaman kecil (7) melintasi setiap seri: urutan sama dengan oracle', async () => {
    const oracle = await oracleKeys(nBersama.spaceId);
    const keys: string[] = [];
    let before: Cursor | null = null;
    for (let i = 0; i < 20; i++) {
      const page: Awaited<ReturnType<typeof sharedActivityTx>> = await withLedger(
        h.pools,
        nBersama.userId,
        nBersama.spaceId,
        (c) => sharedActivityTx(c, nBersama, { limit: 7, before }),
      );
      keys.push(...page.items.map((x) => x.key));
      if (!page.next) break;
      before = parseCursor(encodeCursor(page.next));
    }
    expect(keys).toEqual(oracle);
  });

  it('kursor yang dipotong ke milidetik memang melompati baris (kontrol tes)', async () => {
    const first = await loadAktivitas(nBersama);
    const next = must(first.next);
    const ms = new Date(next.at).toISOString();
    const page2 = await withLedger(h.pools, nBersama.userId, nBersama.spaceId, (c) =>
      c.query<{ n: number }>(
        `select count(*)::int as n from api.shared_activity($1, 100, $2::timestamptz, $3, $4)`,
        [nBersama.spaceId, ms, next.entryId, next.version],
      ),
    );
    const oracle = await oracleKeys(nBersama.spaceId);
    expect(must(page2.rows[0]).n).toBeLessThan(oracle.length - first.items.length);
  });
});

describe('Bersama solo dan baris rusak', () => {
  it('solo: activity, contributions, partner null; halaman Aktivitas tidak memuat feed', async () => {
    await resetLedger(h);
    const { n } = await seedPersonas(h, { farida: 'diundang' });
    const bersama = await ctxOf(n, 'bersama');
    const kas = await wallet(bersama, 'Kas Rumah', 1_000_000);
    await createEntry(bersama, {
      clientId: randomUUID(),
      accountId: kas,
      kind: 'expense',
      amount: 10_000,
      categoryId: await categoryOf(bersama, 'expense'),
    });
    const b = must((await loadBeranda(bersama)).bersama);
    expect(b).toMatchObject({
      members: 1,
      partner: null,
      activity: null,
      contributions: null,
    });
    expect(await loadAktivitas(bersama)).toEqual({ items: [], next: null, partner: null });
  });

  it('baris yang gagal validasi dibuang utuh dengan log tanpa isi; Beranda tetap tampil', async () => {
    await resetLedger(h);
    const { n } = await seedPersonas(h, { farida: 'bergabung' });
    const bersama = await ctxOf(n, 'bersama');
    const kas = await wallet(bersama, 'Kas Rumah', 1_000_000);
    const ok = await createEntry(bersama, {
      clientId: randomUUID(),
      accountId: kas,
      kind: 'expense',
      amount: 10_000,
      categoryId: await categoryOf(bersama, 'expense'),
    });
    // Riwayat sintetis dengan kind tak dikenal tidak bisa dibuat (enum); jadi baris rusak dibuat
    // lewat snapshot tanpa line main: amount NULL melanggar skema (bukan nominal 0 palsu).
    await h.admin.query(
      `insert into app.entry_history (entry_id, space_id, version, op, snapshot, changed_by)
       select entry_id, space_id, 2, 'update',
              jsonb_set(snapshot, '{lines}', '[]'::jsonb) || '{"description":"KANARI-RUSAK"}',
              changed_by
         from app.entry_history where entry_id = $1 and version = 1`,
      [ok.entryId],
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const a = await loadAktivitas(bersama);
      expect(a.items.map((i) => i.key)).toEqual([`${ok.entryId}:1`]);
      const b = await loadBeranda(bersama);
      expect(b.bersama?.activity).toEqual(a.items);
      const logged = spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(logged).toContain('baris feed tidak sah dibuang');
      expect(logged).not.toMatch(/KANARI|10000|10\.000/);
      expect(logged).not.toContain(ok.entryId);
    } finally {
      spy.mockRestore();
    }
  });

  it('galat SQL feed di Beranda: kartu error, Beranda dan Kontribusi tetap tampil', async () => {
    await resetLedger(h);
    const { n } = await seedPersonas(h, { farida: 'bergabung' });
    const bersama = await ctxOf(n, 'bersama');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Kueri feed gagal di DB (fungsi tidak bisa dieksekusi); savepoint menahan galat ke kartu itu.
    await h.admin.query('revoke execute on function api.shared_activity from dompetku_web');
    try {
      const b = await loadBeranda(bersama);
      expect(b.bersama?.activity).toBe('error');
      expect(b.bersama?.contributions).toMatchObject({ allZero: true });
      expect(b.safe).toBeDefined();
      expect(spy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain(
        '[bersama] activity gagal dimuat: 42501',
      );
      expect(toLedgerError(await failure(loadAktivitas(bersama)))).toBeNull();
    } finally {
      await h.admin.query('grant execute on function api.shared_activity to dompetku_web');
      spy.mockRestore();
    }
    expect(Array.isArray((await loadBeranda(bersama)).bersama?.activity)).toBe(true);
  });
});
