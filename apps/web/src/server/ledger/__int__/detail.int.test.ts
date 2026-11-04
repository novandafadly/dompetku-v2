import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDetail } from '../detail';
import { createReimbursement } from '../reimburse';
import { resolveSpace } from '../space';
import {
  createAccount,
  createEntry,
  createSpaceTransfer,
  moveEntryToSpace,
  updateEntry,
  voidEntry,
  type LedgerCtx,
} from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * Jalur data Detail transaksi nyata (page `[ruang]/transaksi/[id]`): `resolveSpace` →
 * `loadDetail`. Entri + riwayat (termasuk yang dibatalkan), dompet dan kategori ruang ini untuk
 * sheet Ubah; id asing = null (page 404); data rute Bersama tanpa kanari Pribadi (Review Focus 4).
 */

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

const KANARI_DESC = 'KANARI-DETAIL-PRIBADI-77c1';
const KANARI_DOMPET = 'KANARI-DOMPET-DETAIL';
const KANARI_RP = 6_543_210;

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<LedgerCtx> {
  const { spaceId } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId };
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

describe('loadDetail (persona N, F bergabung)', () => {
  let n: Persona;
  let f: Persona;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    if (ps.f === null) throw new Error('Farida tidak ada');
    n = ps.n;
    f = ps.f;
  });

  it('N Pribadi: entri + riwayat ubah/batal, dompet dan kategori ruang ini; tetap terbuka saat batal', async () => {
    const pribadi = await ctxOf(n, 'pribadi');
    const acc = await wallet(pribadi, KANARI_DOMPET, 20_000_000);
    const cat = await firstExpenseCategory(pribadi);
    const created = await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: acc,
      kind: 'expense',
      amount: KANARI_RP,
      categoryId: cat,
      description: KANARI_DESC,
    });
    const edited = await updateEntry(pribadi, {
      clientId: randomUUID(),
      entryId: created.entryId,
      expectedVersion: created.version,
      accountId: acc,
      amount: 45_000,
      categoryId: cat,
      occurredOn: null,
      description: KANARI_DESC,
      reimbursable: true,
    });

    const got = await loadDetail(pribadi, created.entryId);
    expect(got?.entry).toMatchObject({
      id: created.entryId,
      version: edited.version,
      kind: 'expense',
      amount: 45_000,
      accountId: acc,
      accountName: KANARI_DOMPET,
      categoryId: cat,
      description: KANARI_DESC,
      reimbursable: true,
      createdBy: { id: n.id, name: 'Novanda', initial: 'N' },
    });
    expect(got?.entry.voidedAt).toBeUndefined();
    expect(
      got?.history.map(({ version, op, changedBy, amount }) => ({
        version,
        op,
        changedBy,
        amount,
      })),
    ).toEqual([
      { version: 1, op: 'create', changedBy: n.id, amount: KANARI_RP },
      { version: 2, op: 'update', changedBy: n.id, amount: 45_000 },
    ]);
    expect(got?.accounts.map((a) => a.name)).toEqual([KANARI_DOMPET]);
    expect(got?.categories.length).toBeGreaterThan(0);
    expect(got?.categories.every((c) => !c.archived)).toBe(true);

    // Entri batal tetap terbuka (S6-D3, bukan 404), dengan stempel batal.
    await voidEntry(pribadi, {
      clientId: randomUUID(),
      entryId: created.entryId,
      expectedVersion: edited.version,
    });
    const voided = await loadDetail(pribadi, created.entryId);
    expect(voided?.entry.voidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
    expect(voided?.history.at(-1)).toMatchObject({ op: 'void', changedBy: n.id });
    expect(voided?.restoreClosed).toBe(false);
    expect(got?.restoreClosed).toBe(false);
    // Lewat 90 hari (jam DB): banner menawarkan teks S6-S1 lewat, bukan Pulihkan.
    await h.admin.query(
      `update app.entries set voided_at = now() - interval '91 days' where id = $1`,
      [created.entryId],
    );
    expect((await loadDetail(pribadi, created.entryId))?.restoreClosed).toBe(true);
  });

  it('id asing = null: ruang lain, ruang orang lain, tidak ada, bukan uuid', async () => {
    const pribadi = await ctxOf(n, 'pribadi');
    const acc = await wallet(pribadi, KANARI_DOMPET, 1_000_000);
    const { entryId } = await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: acc,
      kind: 'expense',
      amount: 10_000,
      categoryId: await firstExpenseCategory(pribadi),
    });
    expect(await loadDetail(await ctxOf(n, 'bersama'), entryId)).toBeNull();
    // Farida anggota Bersama, bukan Pribadi Novanda.
    expect(await loadDetail(await ctxOf(f, 'bersama'), entryId)).toBeNull();
    expect(await loadDetail(await ctxOf(f, 'pribadi'), entryId)).toBeNull();
    expect(await loadDetail(pribadi, randomUUID())).toBeNull();
    expect(await loadDetail(pribadi, 'bukan-uuid')).toBeNull();
  });

  it('detail Bersama tanpa kanari Pribadi (payload RSC)', async () => {
    const pribadi = await ctxOf(n, 'pribadi');
    const kAcc = await wallet(pribadi, KANARI_DOMPET, 20_000_000);
    const kEntry = await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: kAcc,
      kind: 'expense',
      amount: KANARI_RP,
      categoryId: await firstExpenseCategory(pribadi),
      description: KANARI_DESC,
    });

    const bersama = await ctxOf(n, 'bersama');
    const bAcc = await wallet(bersama, 'Kas Rumah', 1_000_000);
    const shared = await createEntry(bersama, {
      clientId: randomUUID(),
      accountId: bAcc,
      kind: 'expense',
      amount: 12_000,
      categoryId: await firstExpenseCategory(bersama),
      description: 'Sabun',
    });
    const got = await loadDetail(bersama, shared.entryId);
    expect(got?.entry).toMatchObject({ description: 'Sabun', accountName: 'Kas Rumah' });
    expect(got?.accounts.map((a) => a.name)).toEqual(['Kas Rumah']);
    const blob = JSON.stringify(got);
    for (const kanari of [
      KANARI_DESC,
      KANARI_DOMPET,
      String(KANARI_RP),
      kAcc,
      kEntry.entryId,
      pribadi.spaceId,
    ]) {
      expect(blob).not.toContain(kanari);
    }
  });
});

describe('loadDetail S7: talangan, antar ruang, pindah', () => {
  let n: Persona;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    n = ps.n;
  });

  it('talangan: reimburse hidup, sisa, dan reimbursesEntryId di Detail reimburse; spaceCount 2', async () => {
    const pribadi = await ctxOf(n, 'pribadi');
    const acc = await wallet(pribadi, 'Mandiri', 20_000_000);
    const cat = await firstExpenseCategory(pribadi);
    const t = await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: acc,
      kind: 'expense',
      amount: 500_000,
      categoryId: cat,
      reimbursable: true,
    });
    const pertama = await loadDetail(pribadi, t.entryId);
    expect(pertama?.spaceCount).toBe(2);
    expect(pertama?.talangan).toEqual({ items: [], reimbursed: 0, remaining: 500_000 });

    const r1 = await createReimbursement(pribadi, {
      clientId: randomUUID(),
      entryId: t.entryId,
      accountId: acc,
      amount: 300_000,
    });
    const r2 = await createReimbursement(pribadi, {
      clientId: randomUUID(),
      entryId: t.entryId,
      accountId: acc,
      amount: 200_000,
    });
    const lunas = await loadDetail(pribadi, t.entryId);
    expect(lunas?.talangan?.remaining).toBe(0);
    expect(lunas?.talangan?.reimbursed).toBe(500_000);
    expect(lunas?.talangan?.items.map((i) => ({ id: i.id, amount: i.amount }))).toEqual([
      { id: r1.entryId, amount: 300_000 },
      { id: r2.entryId, amount: 200_000 },
    ]);

    // Batal salah satu reimburse membuka lagi sisanya.
    const detailR2 = await loadDetail(pribadi, r2.entryId);
    expect(detailR2?.entry).toMatchObject({ kind: 'reimbursement', reimbursesEntryId: t.entryId });
    expect(detailR2?.talangan).toBeNull();
    await voidEntry(pribadi, {
      clientId: randomUUID(),
      entryId: r2.entryId,
      expectedVersion: detailR2?.entry.version ?? 0,
    });
    expect((await loadDetail(pribadi, t.entryId))?.talangan).toMatchObject({
      reimbursed: 300_000,
      remaining: 200_000,
    });
    // Pengeluaran biasa: tanpa talangan.
    const biasa = await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: acc,
      kind: 'expense',
      amount: 1_000,
      categoryId: cat,
    });
    expect((await loadDetail(pribadi, biasa.entryId))?.talangan).toBeNull();
  });

  it('antar ruang: kaki Bersama tanpa dompet/keterangan/id Pribadi; kaki Pribadi bertanda spaceKind', async () => {
    const pribadi = await ctxOf(n, 'pribadi');
    const bersama = await ctxOf(n, 'bersama');
    const dompetP = await wallet(pribadi, KANARI_DOMPET, 5_000_000);
    const dompetB = await wallet(bersama, 'Kas Rumah', 0);
    const st = await createSpaceTransfer(pribadi, {
      clientId: randomUUID(),
      fromAccountId: dompetP,
      toSpaceId: bersama.spaceId,
      toAccountId: dompetB,
      amount: 250_000,
      fee: 6_543,
      description: KANARI_DESC,
      allowNegative: false,
    });
    const kakiB = await loadDetail(bersama, st.linkedEntryId);
    expect(kakiB?.entry).toMatchObject({
      kind: 'space_transfer',
      spaceKind: 'shared',
      accountName: 'Kas Rumah',
    });
    const json = JSON.stringify(kakiB);
    for (const bocor of [KANARI_DESC, KANARI_DOMPET, st.entryId, st.linkId, dompetP]) {
      expect(json).not.toContain(bocor);
    }
    // Id kaki Pribadi dari rute Bersama = tidak ada (ruang berbeda).
    expect(await loadDetail(bersama, st.entryId)).toBeNull();
    const kakiP = await loadDetail(pribadi, st.entryId);
    expect(kakiB?.entry.fee).toBeUndefined();
    expect(json).not.toContain('6543');
    expect(kakiP?.entry.fee).toBe(6_543);
    expect(kakiP?.entry).toMatchObject({
      spaceKind: 'personal',
      description: KANARI_DESC,
      direction: 'out',
    });
    expect(JSON.stringify(kakiP)).not.toContain(st.linkedEntryId);
  });

  it('pindah ruang: entri asal bertanda movedAt (tanpa penunjuk ke tujuan), tetap terbuka', async () => {
    const pribadi = await ctxOf(n, 'pribadi');
    const bersama = await ctxOf(n, 'bersama');
    const dompetP = await wallet(pribadi, KANARI_DOMPET, 5_000_000);
    const dompetB = await wallet(bersama, 'Kas Rumah', 1_000_000);
    const catP = await firstExpenseCategory(pribadi);
    const catB = await firstExpenseCategory(bersama);
    const e = await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: dompetP,
      kind: 'expense',
      amount: 90_000,
      categoryId: catP,
      description: KANARI_DESC,
    });
    const moved = await moveEntryToSpace(pribadi, {
      clientId: randomUUID(),
      entryId: e.entryId,
      expectedVersion: e.version,
      toSpaceId: bersama.spaceId,
      accountId: dompetB,
      categoryId: catB,
    });
    const asal = await loadDetail(pribadi, e.entryId);
    expect(asal?.entry.movedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
    expect(asal?.entry.voidedAt).toBeDefined();
    // Entri baru di Bersama tanpa keterangan Pribadi (R11) dan tanpa penunjuk balik.
    const baru = await loadDetail(bersama, moved.entryId);
    expect(baru?.entry.movedAt).toBeUndefined();
    expect(JSON.stringify(baru)).not.toContain(KANARI_DESC);
    expect(JSON.stringify(baru)).not.toContain(e.entryId);
  });
});
