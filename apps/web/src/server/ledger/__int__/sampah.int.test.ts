import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveSpace } from '../space';
import { loadSampah } from '../sampah';
import { createAccount, createEntry, restoreEntry, voidEntry, type LedgerCtx } from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * Jalur data Sampah nyata (page `[ruang]/sampah`): `resolveSpace` → `loadSampah`. Hanya entri
 * batal ruang ini ≤ 90 hari beserta dompet ruang ini; data ruang lain, dan terutama kanari
 * Pribadi, tidak pernah terbaca dari Bersama (Review Focus 4).
 */

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

const KANARI_DESC = 'KANARI-SAMPAH-PRIBADI-9c41';
const KANARI_DOMPET = 'KANARI-DOMPET-SAMPAH';
const KANARI_RP = 7_654_321;

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<LedgerCtx> {
  const { spaceId } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId };
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

async function expense(
  ctx: LedgerCtx,
  accountId: string,
  amount: number,
  description?: string,
): Promise<{ entryId: string; version: number }> {
  const { rows } = await h.admin.query<{ id: string }>(
    `select id from app.categories
      where space_id = $1 and type = 'expense' and parent_id is null
      order by sort_order limit 1`,
    [ctx.spaceId],
  );
  const categoryId = rows[0]?.id;
  if (!categoryId) throw new Error('kategori awal tidak ada');
  return createEntry(ctx, {
    clientId: randomUUID(),
    accountId,
    kind: 'expense',
    amount,
    categoryId,
    ...(description === undefined ? {} : { description }),
  });
}

describe('loadSampah (persona N, F bergabung)', () => {
  let n: Persona;
  let f: Persona;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    n = ps.n;
    if (ps.f === null) throw new Error('F tidak bergabung');
    f = ps.f;
  });

  it('ruang baru: tidak ada entri batal', async () => {
    for (const ruang of ['pribadi', 'bersama'] as const) {
      expect((await loadSampah(await ctxOf(n, ruang))).items).toEqual([]);
    }
  });

  it('entri batal ≤ 90 hari, terbaru dulu, dengan dompet ruang ini; Pulihkan menghapusnya dari daftar', async () => {
    const pribadi = await ctxOf(n, 'pribadi');
    const a = await wallet(pribadi, KANARI_DOMPET, 20_000_000);
    const lewat = await expense(pribadi, a, 1_000);
    const lama = await expense(pribadi, a, 2_000);
    const baru = await expense(pribadi, a, KANARI_RP, KANARI_DESC);
    const hidup = await expense(pribadi, a, 4_000);
    for (const e of [lewat, lama, baru]) {
      await voidEntry(pribadi, { clientId: randomUUID(), entryId: e.entryId, expectedVersion: 1 });
    }
    const ago = (id: string, interval: string) =>
      h.admin.query(`update app.entries set voided_at = now() - $2::interval where id = $1`, [
        id,
        interval,
      ]);
    await ago(lewat.entryId, '90 days 1 minute');
    await ago(lama.entryId, '10 days');
    await ago(baru.entryId, '1 day');

    const data = await loadSampah(pribadi);
    expect(data.items.map((t) => t.entry.id)).toEqual([baru.entryId, lama.entryId]);
    expect(data.items.map((t) => t.entry.id)).not.toContain(hidup.entryId);
    expect(data.items[0]?.entry).toMatchObject({
      amount: KANARI_RP,
      description: KANARI_DESC,
      accountName: KANARI_DOMPET,
    });
    expect(data.items[0]?.purgeAfter).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
    // Nilainya: waktu batal + 90 hari (detik penuh, jam WIB), untuk kedua baris.
    const { rows: voidedAt } = await h.admin.query<{ id: string; epoch: string }>(
      `select id, floor(extract(epoch from voided_at))::bigint::text as epoch
         from app.entries where id = any($1::uuid[])`,
      [[baru.entryId, lama.entryId]],
    );
    for (const t of data.items) {
      const epoch = Number(voidedAt.find((r) => r.id === t.entry.id)?.epoch);
      expect(Date.parse(t.purgeAfter) / 1000).toBe(epoch + 90 * 86_400);
    }
    // Dompet ruang ini ikut (saldo untuk peringatan pulihkan): saldo awal − pengeluaran hidup.
    expect(data.accounts.map((x) => x.name)).toEqual([KANARI_DOMPET]);
    expect(data.accounts[0]?.balance).toBe(20_000_000 - 4_000);

    await restoreEntry(pribadi, {
      clientId: randomUUID(),
      entryId: baru.entryId,
      expectedVersion: data.items[0]?.entry.version ?? 0,
    });
    expect((await loadSampah(pribadi)).items.map((t) => t.entry.id)).toEqual([lama.entryId]);
  });

  it('Bersama tidak membawa kanari Pribadi; F tidak melihat Sampah Pribadi N', async () => {
    const pribadi = await ctxOf(n, 'pribadi');
    const a = await wallet(pribadi, KANARI_DOMPET, 20_000_000);
    const e = await expense(pribadi, a, KANARI_RP, KANARI_DESC);
    await voidEntry(pribadi, { clientId: randomUUID(), entryId: e.entryId, expectedVersion: 1 });
    const kas = await wallet(await ctxOf(n, 'bersama'), 'Kas Rumah', 1_000_000);
    const gabung = await expense(await ctxOf(n, 'bersama'), kas, 5_000, 'Listrik bersama');
    await voidEntry(await ctxOf(n, 'bersama'), {
      clientId: randomUUID(),
      entryId: gabung.entryId,
      expectedVersion: 1,
    });

    const bersamaN = await loadSampah(await ctxOf(n, 'bersama'));
    expect(bersamaN.items.map((t) => t.entry.description)).toEqual(['Listrik bersama']);
    expect(JSON.stringify(bersamaN)).not.toContain(KANARI_DESC);
    expect(JSON.stringify(bersamaN)).not.toContain(KANARI_DOMPET);
    // F anggota Bersama: melihat entri batal Bersama (dibatalkan N), tidak yang Pribadi.
    const bersamaF = await loadSampah(await ctxOf(f, 'bersama'));
    expect(bersamaF.items.map((t) => t.entry.description)).toEqual(['Listrik bersama']);
    expect(JSON.stringify(bersamaF)).not.toContain(KANARI_DESC);
    const pribadiF = await loadSampah(await ctxOf(f, 'pribadi'));
    expect(pribadiF.items).toEqual([]);
    expect(JSON.stringify(pribadiF)).not.toContain(KANARI_DESC);
  });
});
