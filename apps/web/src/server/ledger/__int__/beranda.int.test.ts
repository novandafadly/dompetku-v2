import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadBeranda } from '../beranda';
import { listAccounts } from '../read';
import { resolveSpace } from '../space';
import { createAccount, createEntry, type LedgerCtx } from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * Jalur data Beranda nyata (page `[ruang]/beranda`): ruang di URL → `resolveSpace` → `loadBeranda`.
 * Bentuk VM yang dirangkai, dan data rute Bersama tanpa kanari Pribadi (Review Focus 4).
 */

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

const KANARI_DESC = 'KANARI-BERANDA-PRIBADI-91c2';
const KANARI_DOMPET = 'KANARI-DOMPET-BERANDA';
const KANARI_RP = 6_543_217;

type BerandaCtx = LedgerCtx & { kind: 'personal' | 'shared' };

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<BerandaCtx> {
  const { spaceId, kind } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId, kind };
}

async function firstExpenseCategory(ctx: LedgerCtx): Promise<string> {
  const { rows } = await h.admin.query<{ id: string }>(
    `select id from app.categories
      where space_id = $1 and type = 'expense' and parent_id is null
      order by sort_order limit 1`,
    [ctx.spaceId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('kategori awal tidak ada');
  return id;
}

async function wallet(
  ctx: LedgerCtx,
  name: string,
  openingBalance: number,
  pocket: 'operasional' | 'tabungan' = 'operasional',
): Promise<string> {
  const { accountId } = await createAccount(ctx, {
    clientId: randomUUID(),
    name,
    pocket,
    walletType: 'bank',
    openingBalance,
  });
  return accountId;
}

describe('loadBeranda (persona N)', () => {
  it('N baru, Farida belum bergabung: VM kosong, Undang Farida hanya di Pribadi', async () => {
    await resetLedger(h);
    const { n } = await seedPersonas(h, { farida: 'diundang' });
    for (const ruang of ['pribadi', 'bersama'] as const) {
      const data = await loadBeranda(await ctxOf(n, ruang));
      expect(data).toEqual({
        safe: { operasional: 0, billsUntilEom: 0, budgetWajibRemaining: 0, aman: 0 },
        today: { hasEntry: false, noSpendMarked: false },
        hasOperasional: false,
        hasExpense: false,
        recent: [],
        invite: ruang === 'pribadi',
      });
    }
    // Dompet tabungan saja bukan dompet operasional (checklist dan kartu B3 tetap).
    const pribadi = await ctxOf(n, 'pribadi');
    await wallet(pribadi, 'Tabungan', 500_000, 'tabungan');
    expect((await loadBeranda(pribadi)).hasOperasional).toBe(false);
    // Dompet yang sudah dimuat untuk request yang sama dipakai ulang (layout + page).
    const loaded = await listAccounts(pribadi);
    const given = await loadBeranda(pribadi, {
      accounts: Promise.resolve(loaded.map((x) => ({ ...x, pocket: 'operasional' as const }))),
    });
    expect(given.hasOperasional).toBe(true);
  });

  describe('N dan F bergabung', () => {
    let n: Persona;
    let f: Persona;

    beforeEach(async () => {
      await resetLedger(h);
      const ps = await seedPersonas(h, { farida: 'bergabung' });
      n = ps.n;
      if (!ps.f) throw new Error('Farida tidak ada');
      f = ps.f;
    });

    it('Pribadi: VM terisi; Bersama: tanpa kanari Pribadi; Undang Farida hilang', async () => {
      const pribadi = await ctxOf(n, 'pribadi');
      const kAcc = await wallet(pribadi, KANARI_DOMPET, 20_000_000);
      const { entryId } = await createEntry(pribadi, {
        clientId: randomUUID(),
        accountId: kAcc,
        kind: 'expense',
        amount: KANARI_RP,
        categoryId: await firstExpenseCategory(pribadi),
        description: KANARI_DESC,
      });
      const bersama = await ctxOf(n, 'bersama');
      await wallet(bersama, 'Kas Rumah', 1_000_000);

      const p = await loadBeranda(pribadi);
      expect(p.hasOperasional).toBe(true);
      expect(p.hasExpense).toBe(true);
      expect(p.today).toEqual({ hasEntry: true, noSpendMarked: false });
      expect(p.safe.operasional).toBe(20_000_000 - KANARI_RP);
      expect(p.safe.aman).toBe(20_000_000 - KANARI_RP);
      expect(p.recent.map((e) => e.id)).toContain(entryId);
      expect(p.recent.find((e) => e.id === entryId)).toMatchObject({
        kind: 'expense',
        amount: KANARI_RP,
        description: KANARI_DESC,
        accountName: KANARI_DOMPET,
      });
      expect(p.recent.length).toBeLessThanOrEqual(5);
      expect(p.invite).toBe(false);

      const b = await loadBeranda(bersama);
      expect(b).toMatchObject({
        hasOperasional: true,
        hasExpense: false,
        today: { hasEntry: false, noSpendMarked: false },
        safe: { operasional: 1_000_000, aman: 1_000_000 },
        invite: false,
      });
      // Saldo awal bukan pengeluaran dan bukan "mencatat hari ini".
      expect(b.recent.map((e) => e.kind)).toEqual(['opening_balance']);

      // Data page Bersama (yang diserialisasi ke payload RSC) tanpa jejak Pribadi.
      const blob = JSON.stringify(b);
      for (const kanari of [
        KANARI_DESC,
        KANARI_DOMPET,
        String(KANARI_RP),
        kAcc,
        entryId,
        pribadi.spaceId,
      ]) {
        expect(blob).not.toContain(kanari);
      }

      // Farida (anggota, bukan pemilik) tidak pernah melihat Undang Farida.
      expect((await loadBeranda(await ctxOf(f, 'bersama'))).invite).toBe(false);
    });
  });
});
