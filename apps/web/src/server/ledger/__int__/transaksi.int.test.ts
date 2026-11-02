import { randomUUID } from 'node:crypto';
import { addMonths } from '@dompetku/domain';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveSpace } from '../space';
import { loadTransaksi } from '../transaksi';
import { createAccount, createEntry, voidEntry, type LedgerCtx } from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * Jalur data Transaksi nyata (page `[ruang]/transaksi`): `resolveSpace` → `loadTransaksi`.
 * Daftar bulan + ringkasan + penanda "pernah ada entri", dan data rute Bersama tanpa kanari
 * Pribadi (Review Focus 4).
 */

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

const KANARI_DESC = 'KANARI-TRANSAKSI-PRIBADI-5e1a';
const KANARI_DOMPET = 'KANARI-DOMPET-TRANSAKSI';
const KANARI_RP = 7_654_321;

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<LedgerCtx> {
  const { spaceId } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId };
}

async function today(): Promise<string> {
  const { rows } = await h.admin.query<{ d: string }>(`select app.today()::text as d`);
  const d = rows[0]?.d;
  if (!d) throw new Error('app.today kosong');
  return d;
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

describe('loadTransaksi (persona N, F bergabung)', () => {
  let n: Persona;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    n = ps.n;
  });

  it('ruang baru: daftar kosong, ringkasan nol, belum pernah ada entri', async () => {
    const month = (await today()).slice(0, 7);
    for (const ruang of ['pribadi', 'bersama'] as const) {
      expect(await loadTransaksi(await ctxOf(n, ruang), month)).toEqual({
        entries: [],
        summary: { pemasukan: 0, pengeluaran: 0, selisih: 0, transfer: 0 },
        hasAny: false,
      });
    }
  });

  it('Pribadi: entri bulan ini + ringkasan; bulan lain kosong tapi hasAny; Bersama tanpa kanari', async () => {
    const month = (await today()).slice(0, 7);
    const pribadi = await ctxOf(n, 'pribadi');
    const kAcc = await wallet(pribadi, KANARI_DOMPET, 20_000_000);
    const cat = await firstExpenseCategory(pribadi);
    const { entryId } = await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: kAcc,
      kind: 'expense',
      amount: KANARI_RP,
      categoryId: cat,
      description: KANARI_DESC,
    });
    const voided = await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: kAcc,
      kind: 'expense',
      amount: 1_000,
      categoryId: cat,
    });
    await voidEntry(pribadi, {
      clientId: randomUUID(),
      entryId: voided.entryId,
      expectedVersion: voided.version,
    });

    const p = await loadTransaksi(pribadi, month);
    expect(p.hasAny).toBe(true);
    // Saldo awal + kanari; entri batal tidak ikut.
    expect(p.entries.map((e) => e.kind).sort()).toEqual(['expense', 'opening_balance']);
    expect(p.entries.map((e) => e.id)).not.toContain(voided.entryId);
    expect(p.entries.find((e) => e.id === entryId)).toMatchObject({
      amount: KANARI_RP,
      description: KANARI_DESC,
      accountName: KANARI_DOMPET,
    });
    expect(p.summary).toEqual({
      pemasukan: 0,
      pengeluaran: KANARI_RP,
      selisih: -KANARI_RP,
      transfer: 0,
    });

    // Bulan sebelumnya: kosong, tetapi ruang pernah punya entri (bukan kosong pertama kali).
    const prev = await loadTransaksi(pribadi, addMonths(month, -1));
    expect(prev.entries).toEqual([]);
    expect(prev.hasAny).toBe(true);

    const bersama = await ctxOf(n, 'bersama');
    await wallet(bersama, 'Kas Rumah', 1_000_000);
    const b = await loadTransaksi(bersama, month);
    expect(b.entries.map((e) => e.kind)).toEqual(['opening_balance']);
    expect(b.summary.pengeluaran).toBe(0);
    // Data page Bersama (diserialisasi ke payload RSC) tanpa jejak Pribadi.
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
  });

  it('bulan tidak sah ditolak loader (page memvalidasi lebih dulu)', async () => {
    await expect(loadTransaksi(await ctxOf(n, 'pribadi'), '2026-13')).rejects.toThrow();
  });
});
