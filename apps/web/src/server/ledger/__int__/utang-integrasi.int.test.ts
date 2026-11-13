import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { groupByDayVM } from '@/features/ledger/group-by-day';
import { entryKindLabelVM, entryTitleVM } from '@/features/ledger/present';
import { excludedLines } from '@/features/laporan/present';
import { detailAbilities } from '@/app/[ruang]/_real/detail';
import { loadDetail } from '../detail';
import { exportLaporanCsv } from '../ekspor';
import { loadLaporan } from '../laporan';
import { monthSummary } from '../read';
import { loadSampah } from '../sampah';
import { resolveSpace } from '../space';
import { loadTransaksi } from '../transaksi';
import { createDebt, payDebt, restoreDebt, voidDebt } from '../utang';
import { createAccount, createEntry, voidEntry, type LedgerCtx } from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * Integrasi S11 Task 7: pokok dan cicilan utang di Transaksi (daftar, detail), Laporan ("Tidak
 * termasuk"), Ekspor CSV, dan Sampah, lewat loader TS terhadap Postgres nyata. Yang dijaga (I6):
 * Σ pemasukan/pengeluaran tidak berubah oleh utang; kelas x_pokok_utang / x_pelunasan_utang
 * muncul dengan nominal benar; Bersama tidak melihat jejak utang.
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

async function expenseCategory(ctx: LedgerCtx): Promise<string> {
  const { rows } = await h.admin.query<{ id: string }>(
    `select id from app.categories
      where space_id = $1 and type = 'expense' and parent_id is null order by sort_order limit 1`,
    [ctx.spaceId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('kategori pengeluaran tidak ada');
  return id;
}

async function incomeCategory(ctx: LedgerCtx): Promise<string> {
  const { rows } = await h.admin.query<{ id: string }>(
    `select id from app.categories
      where space_id = $1 and type = 'income' and parent_id is null order by sort_order limit 1`,
    [ctx.spaceId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('kategori pemasukan tidak ada');
  return id;
}

async function today(): Promise<string> {
  const { rows } = await h.admin.query<{ d: string }>(
    "select to_char(app.today(), 'YYYY-MM-DD') as d",
  );
  return rows[0]?.d ?? '';
}

function must<T>(v: T | null): T {
  if (v === null) throw new Error('data tidak ada');
  return v;
}

const POKOK_PINJAM = 2_000_000;
const CICIL_UTANG = 300_000;
const POKOK_PIUTANG = 750_000;
const CICIL_PIUTANG = 250_000;
const GAJI = 500_000;
const MAKAN = 40_000;

describe('S11 Task 7: Transaksi, Laporan, Ekspor, Sampah untuk pokok dan cicilan utang', () => {
  let n: Persona;
  let pribadi: Ctx;
  let bersama: Ctx;
  let bca: string;
  let month: string;
  let utang: Awaited<ReturnType<typeof createDebt>>;
  let piutang: Awaited<ReturnType<typeof createDebt>>;
  let cicilUtang: Awaited<ReturnType<typeof payDebt>>;
  let cicilPiutang: Awaited<ReturnType<typeof payDebt>>;
  let sebelum: { pemasukan: number; pengeluaran: number };

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    n = ps.n;
    pribadi = await ctxOf(n, 'pribadi');
    bersama = await ctxOf(n, 'bersama');
    month = (await today()).slice(0, 7);
    bca = (
      await createAccount(pribadi, {
        clientId: randomUUID(),
        name: 'BCA',
        pocket: 'operasional',
        walletType: 'bank',
        openingBalance: 1_000_000,
      })
    ).accountId;
    await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: bca,
      kind: 'income',
      amount: GAJI,
      categoryId: await incomeCategory(pribadi),
    });
    await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: bca,
      kind: 'expense',
      amount: MAKAN,
      categoryId: await expenseCategory(pribadi),
      description: 'Makan siang',
    });
    const s = await monthSummary(pribadi, month);
    sebelum = { pemasukan: s.pemasukan, pengeluaran: s.pengeluaran };
    expect(sebelum).toEqual({ pemasukan: GAJI, pengeluaran: MAKAN });

    utang = await createDebt(pribadi, {
      clientId: randomUUID(),
      direction: 'borrowed',
      principal: POKOK_PINJAM,
      mode: 'baru',
      contactName: 'Budi',
      accountId: bca,
      title: 'Motor',
    });
    cicilUtang = await payDebt(pribadi, {
      clientId: randomUUID(),
      debtId: utang.debtId,
      accountId: bca,
      amount: CICIL_UTANG,
    });
    piutang = await createDebt(pribadi, {
      clientId: randomUUID(),
      direction: 'lent',
      principal: POKOK_PIUTANG,
      mode: 'baru',
      contactName: 'Sari',
      accountId: bca,
    });
    cicilPiutang = await payDebt(pribadi, {
      clientId: randomUUID(),
      debtId: piutang.debtId,
      accountId: bca,
      amount: CICIL_PIUTANG,
    });
    // Utang berjalan: tanpa entri, tidak muncul di mana pun.
    await createDebt(pribadi, {
      clientId: randomUUID(),
      direction: 'borrowed',
      principal: 900_000,
      mode: 'berjalan',
      contactName: 'Ibu',
    });
  });

  it('Laporan: Σ pemasukan/pengeluaran tak berubah [I6]; kelas utang per arah dengan nominal benar, bernama', async () => {
    const lp = await loadLaporan(pribadi, { basis: 'kalender' });
    expect(lp.summary.pemasukan).toBe(sebelum.pemasukan);
    expect(lp.summary.pengeluaran).toBe(sebelum.pengeluaran);
    const kelas = Object.fromEntries(
      lp.classes
        .filter((c) => c.reportClass.endsWith('_utang'))
        .map((c) => [`${c.reportClass}:${c.direction}`, [c.amount, c.entryCount]]),
    );
    expect(kelas).toEqual({
      'x_pokok_utang:in': [POKOK_PINJAM, 1],
      'x_pokok_utang:out': [POKOK_PIUTANG, 1],
      'x_pelunasan_utang:out': [CICIL_UTANG, 1],
      'x_pelunasan_utang:in': [CICIL_PIUTANG, 1],
    });
    const baris = excludedLines(lp.classes, 'pribadi');
    const nama = (k: string) => baris.find((l) => l.key === k)?.name;
    expect(nama('x_pokok_utang:in')).toBe('Pinjaman diterima');
    expect(nama('x_pokok_utang:out')).toBe('Pinjaman diberikan');
    expect(nama('x_pelunasan_utang:out')).toBe('Pelunasan utang');
    expect(nama('x_pelunasan_utang:in')).toBe('Penerimaan piutang');
    expect(baris.map((l) => l.name)).not.toContain('Lainnya');
    // Kategori Laporan tidak memuat uang utang (tanpa baris "Tanpa kategori" dari entri utang).
    expect(lp.categories.some((c) => c.kind === 'uncategorized')).toBe(false);
  });

  it('Ekspor CSV: baris per kaki dengan jenis dan kelas utang, Σ = Laporan, nominal bertanda polos', async () => {
    const ex = await exportLaporanCsv(pribadi, { basis: 'kalender' });
    const lp = await loadLaporan(pribadi, { basis: 'kalender' });
    const sums = {
      pemasukan: ex.rows
        .filter((r) => r.reportClass === 'income')
        .reduce((a, r) => a + r.amount, 0),
      pengeluaran: -ex.rows
        .filter((r) => r.reportClass === 'expense' || r.reportClass === 'expense_fee')
        .reduce((a, r) => a + r.amount, 0),
    };
    expect(sums).toEqual({ pemasukan: lp.summary.pemasukan, pengeluaran: lp.summary.pengeluaran });

    const utangRows = ex.rows
      .filter((r) => r.kind === 'debt_principal' || r.kind === 'debt_payment')
      .map((r) => [r.kind, r.reportClass, r.amount, r.account, r.category])
      .sort();
    expect(utangRows).toEqual(
      [
        ['debt_principal', 'x_pokok_utang', POKOK_PINJAM, 'BCA', null],
        ['debt_principal', 'x_pokok_utang', -POKOK_PIUTANG, 'BCA', null],
        ['debt_payment', 'x_pelunasan_utang', -CICIL_UTANG, 'BCA', null],
        ['debt_payment', 'x_pelunasan_utang', CICIL_PIUTANG, 'BCA', null],
      ].sort(),
    );
    // Nominal negatif ditulis polos (tanpa awalan ' escape rumus); jenis dan kelas tidak di-escape.
    expect(ex.csv).toContain(`debt_principal,main,x_pokok_utang,BCA,,,-${String(POKOK_PIUTANG)},`);
    expect(ex.csv).toContain(`debt_payment,main,x_pelunasan_utang,BCA,,,-${String(CICIL_UTANG)},`);
    expect(ex.csv).not.toContain("'-");
    expect(ex.csv.split('\r\n')).toHaveLength(ex.rows.length + 2);
  });

  it('Transaksi bulan ini: entri utang membawa kontak/judul/arah, ringkasan dan total hari tak berubah', async () => {
    const t = await loadTransaksi(pribadi, month);
    expect(t.summary.pemasukan).toBe(sebelum.pemasukan);
    expect(t.summary.pengeluaran).toBe(sebelum.pengeluaran);
    const byId = new Map(t.entries.map((e) => [e.id, e]));
    const pokokUtang = byId.get(utang.entryId ?? '');
    const bayar = byId.get(cicilUtang.entryId);
    const terima = byId.get(cicilPiutang.entryId);
    const pokokPiutang = byId.get(piutang.entryId ?? '');
    expect(pokokUtang).toMatchObject({
      kind: 'debt_principal',
      direction: 'in',
      amount: POKOK_PINJAM,
      debt: { id: utang.debtId, direction: 'borrowed', contactName: 'Budi', title: 'Motor' },
    });
    expect(pokokUtang?.debt?.deleted).toBeUndefined();
    expect(bayar).toMatchObject({ kind: 'debt_payment', direction: 'out', amount: CICIL_UTANG });
    expect(terima).toMatchObject({
      kind: 'debt_payment',
      direction: 'in',
      debt: { direction: 'lent', contactName: 'Sari' },
    });
    expect(pokokPiutang).toMatchObject({ kind: 'debt_principal', direction: 'out' });
    expect(pokokPiutang?.debt?.title).toBeUndefined();
    // Judul dan jenis dari presenter: tidak ada "Tanpa kategori".
    const label = (id: string) => {
      const e = byId.get(id);
      if (!e) throw new Error('entri tidak ada');
      return [entryTitleVM(e), entryKindLabelVM(e)];
    };
    expect(label(utang.entryId ?? '')).toEqual(['Budi · Motor', 'Pinjaman diterima']);
    expect(label(cicilUtang.entryId)).toEqual(['Budi · Motor', 'Pembayaran utang']);
    expect(label(cicilPiutang.entryId)).toEqual(['Sari', 'Penerimaan piutang']);
    expect(label(piutang.entryId ?? '')).toEqual(['Sari', 'Pinjaman diberikan']);
    // Utang berjalan tanpa entri; hanya empat entri utang + gaji + makan + saldo awal.
    expect(t.entries.filter((e) => e.debt !== undefined)).toHaveLength(4);
    const hari = groupByDayVM(t.entries, await today());
    expect(hari.reduce((a, g) => a + g.total, 0)).toBe(GAJI - MAKAN);
  });

  it('Detail: cicilan hanya bisa Batalkan, pokok tanpa aksi; kontak/judul terbaca', async () => {
    const dp = await loadDetail(pribadi, cicilUtang.entryId);
    expect(dp?.entry.debt).toMatchObject({ contactName: 'Budi', title: 'Motor' });
    const acc = { accounts: dp?.accounts ?? [], spaceCount: dp?.spaceCount ?? 0, talangan: null };
    expect(detailAbilities(must(dp).entry, acc, await today(), n.id)).toEqual({
      editable: false,
      voidable: true,
      movable: false,
      reimbursable: null,
    });
    const pk = await loadDetail(pribadi, utang.entryId ?? '');
    expect(detailAbilities(must(pk).entry, acc, await today(), n.id)).toEqual({
      editable: false,
      voidable: false,
      movable: false,
      reimbursable: null,
    });
  });

  it('Sampah: cicilan batal sendiri tampil dengan kontaknya; Hapus utang menyembunyikan semuanya, detail menandai utang dihapus, restore mengembalikan', async () => {
    const v = await voidEntry(pribadi, {
      clientId: randomUUID(),
      entryId: cicilUtang.entryId,
      expectedVersion: cicilUtang.version,
    });
    expect(v.version).toBeGreaterThan(cicilUtang.version);
    let s = await loadSampah(pribadi);
    expect(s.items.map((t) => t.entry.id)).toEqual([cicilUtang.entryId]);
    expect(s.items[0]?.entry).toMatchObject({
      kind: 'debt_payment',
      debt: { contactName: 'Budi', direction: 'borrowed' },
    });
    expect(s.items[0]?.entry.debt?.deleted).toBeUndefined();

    // Hapus utang Budi: entri pokok + cicilan hidup ikut batal; tak satu pun tampil di Sampah.
    const vd = await voidDebt(pribadi, { clientId: randomUUID(), debtId: utang.debtId });
    expect(vd.affected.length).toBeGreaterThanOrEqual(1);
    s = await loadSampah(pribadi);
    expect(s.items).toEqual([]);
    const dp = await loadDetail(pribadi, utang.entryId ?? '');
    expect(dp?.entry.voidedAt).toBeDefined();
    expect(dp?.entry.debt).toMatchObject({
      contactName: 'Budi',
      deleted: true,
      voidedWithDebt: true,
    });
    const t = await loadTransaksi(pribadi, month);
    expect(t.entries.some((e) => e.debt?.contactName === 'Budi')).toBe(false);
    // Σ Laporan tetap; kelas pinjaman Budi hilang dari "Tidak termasuk".
    const lp = await loadLaporan(pribadi, { basis: 'kalender' });
    expect(lp.summary.pemasukan).toBe(sebelum.pemasukan);
    expect(lp.classes.find((c) => c.reportClass === 'x_pokok_utang' && c.direction === 'in')).toBe(
      undefined,
    );

    await restoreDebt(pribadi, { clientId: randomUUID(), debtId: utang.debtId });
    const lp2 = await loadLaporan(pribadi, { basis: 'kalender' });
    expect(
      lp2.classes.find((c) => c.reportClass === 'x_pokok_utang' && c.direction === 'in')?.amount,
    ).toBe(POKOK_PINJAM);
    // Cicilan yang dibatalkan sendiri sebelumnya kembali tampil di Sampah (utangnya hidup lagi).
    s = await loadSampah(pribadi);
    expect(s.items.map((x) => x.entry.id)).toEqual([cicilUtang.entryId]);
  });

  it('Bersama: tanpa jejak utang di Transaksi, Laporan, dan CSV', async () => {
    const t = await loadTransaksi(bersama, month);
    expect(t.entries.some((e) => e.debt !== undefined || e.kind.startsWith('debt_'))).toBe(false);
    const lp = await loadLaporan(bersama, { basis: 'kalender' });
    expect(lp.classes.some((c) => c.reportClass.endsWith('_utang'))).toBe(false);
    const ex = await exportLaporanCsv(bersama, { basis: 'kalender' });
    expect(ex.csv).not.toMatch(/debt_|_utang|Budi|Sari/);
  });
});
