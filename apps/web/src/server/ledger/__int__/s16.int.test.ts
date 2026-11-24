import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { formatRupiah } from '@dompetku/domain';
import { exportLaporanPdf } from '../ekspor';
import { toLedgerError } from '../errors';
import { loadKalender } from '../kalender';
import { dismissSubscription } from '../langganan';
import { loadLaporan } from '../laporan';
import { createBill, loadRencana } from '../rencana';
import { listCategories, safeToSpend } from '../read';
import { resolveSpace } from '../space';
import { createAccount, createEntry, type LedgerCtx } from '../write';
import { createLedgerHarness, resetLedger, seedPersonas, type Persona } from './harness';

/**
 * S16 Task 4: tes integrasi Postgres nyata untuk kalender arus kas, deteksi langganan, dan ekspor PDF.
 * Tag:
 * - `[B13]`: PDF Bersama, kalender Bersama, dan saran langganan Bersama tidak pernah memuat kanari Pribadi.
 * - `[K9]`: teks berbahaya di deskripsi transaksi di-escape di berkas PDF nyata tanpa aksi PDF.
 * - Paritas Laporan: angka pemasukan/pengeluaran/selisih dan daftar transaksi di PDF = `loadLaporan`.
 */

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<LedgerCtx> {
  const { spaceId } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId };
}

function daysAgo(isoToday: string, n: number): `${number}-${number}-${number}` {
  const d = new Date(`${isoToday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10) as `${number}-${number}-${number}`;
}

function monthsAgoDay(
  isoToday: string,
  back: number,
  day: number,
): `${number}-${number}-${number}` {
  const [y, m] = isoToday.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 - back, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10) as `${number}-${number}-${number}`;
}

describe('S16 integrasi — kalender arus kas, deteksi langganan, ekspor PDF', () => {
  let n: Persona;
  let f: Persona;
  let luar: Persona;
  let nPribadi: LedgerCtx;
  let nBersama: LedgerCtx;
  let fBersama: LedgerCtx;
  let today: `${number}-${number}-${number}`;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung', luar: true });
    if (!ps.f || !ps.luar) throw new Error('persona kurang');
    n = ps.n;
    f = ps.f;
    luar = ps.luar;
    nPribadi = await ctxOf(n, 'pribadi');
    nBersama = await ctxOf(n, 'bersama');
    fBersama = await ctxOf(f, 'bersama');
    const r = await h.admin.query<{ d: string }>("select to_char(app.today(), 'YYYY-MM-DD') as d");
    today = (r.rows[0]?.d ?? '2026-11-10') as `${number}-${number}-${number}`;
  });

  const pickCat = async (ctx: LedgerCtx, type: 'expense' | 'income'): Promise<string> => {
    const cats = await listCategories(ctx);
    const hit = cats.find((c) => c.type === type && c.parentId === null);
    if (!hit) throw new Error(`kategori ${type} tidak ada`);
    return hit.id;
  };

  it('[B13] [K9] PDF Laporan angkanya sama persis dengan loadLaporan, escape penuh, Bersama tanpa kanari Pribadi', async () => {
    const { accountId: bca } = await createAccount(nPribadi, {
      clientId: randomUUID(),
      name: 'BCA Pribadi',
      pocket: 'operasional',
      walletType: 'bank',
      openingBalance: 10_000_000,
    });
    const { accountId: kas } = await createAccount(nBersama, {
      clientId: randomUUID(),
      name: 'Kas Bersama',
      pocket: 'operasional',
      walletType: 'bank',
      openingBalance: 8_000_000,
    });
    const catExpP = await pickCat(nPribadi, 'expense');
    const catIncP = await pickCat(nPribadi, 'income');
    const catExpB = await pickCat(nBersama, 'expense');

    // Entri Pribadi termasuk kanari rahasia dan payload injeksi K9.
    await createEntry(nPribadi, {
      clientId: randomUUID(),
      accountId: bca,
      kind: 'income',
      amount: 6_500_000,
      categoryId: catIncP,
      occurredOn: today,
      description: 'Gaji Pribadi',
    });
    await createEntry(nPribadi, {
      clientId: randomUUID(),
      accountId: bca,
      kind: 'expense',
      amount: 123_456,
      categoryId: catExpP,
      occurredOn: today,
      description: 'KANARI-PDF ) /JS (x) =cmd',
    });
    const catsP = await listCategories(nPribadi);
    const subExpP = catsP.find((c) => c.type === 'expense' && c.parentId !== null);
    if (subExpP) {
      await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: bca,
        kind: 'expense',
        amount: 25_000,
        categoryId: subExpP.id,
        occurredOn: today,
        description: 'Uji subkategori PDF',
      });
    }
    // Entri Bersama.
    await createEntry(nBersama, {
      clientId: randomUUID(),
      accountId: kas,
      kind: 'expense',
      amount: 250_000,
      categoryId: catExpB,
      occurredOn: today,
      description: 'Belanja Dapur Bersama',
    });

    const lapP = await loadLaporan({ ...nPribadi, kind: 'personal' });
    const pdfP = await exportLaporanPdf({ ...nPribadi, kind: 'personal' });
    expect(pdfP.summary).toEqual({
      pemasukan: lapP.summary.pemasukan,
      pengeluaran: lapP.summary.pengeluaran,
      selisih: lapP.summary.selisih,
    });
    const textP = Buffer.from(pdfP.pdf).toString('latin1');
    expect(textP.startsWith('%PDF-1.4\n')).toBe(true);
    expect(textP.endsWith('%%EOF\n')).toBe(true);
    // Angka Laporan tampil utuh di PDF (NBSP dinormalisasi jadi spasi).
    expect(textP).toContain(formatRupiah(lapP.summary.pemasukan).replace('\u00a0', ' '));
    expect(textP).toContain(formatRupiah(lapP.summary.pengeluaran).replace('\u00a0', ' '));
    // Jumlah transaksi grup kategori tidak pernah tercetak 0 meski semua entri di subkategori.
    expect(textP).not.toContain('Td (0) Tj ET');
    // K9: tanda kurung ter-escape sehingga tidak keluar dari literal PDF.
    expect(textP).toContain('KANARI-PDF \\) /JS \\(x\\) =cmd');
    expect(textP).not.toMatch(/\/Type\s+\/Annot/);

    // B13: PDF Bersama oleh F tidak memuat kanari Pribadi N.
    const lapB = await loadLaporan({ ...fBersama, kind: 'shared' });
    const pdfB = await exportLaporanPdf({ ...fBersama, kind: 'shared' });
    expect(pdfB.summary).toEqual({
      pemasukan: lapB.summary.pemasukan,
      pengeluaran: lapB.summary.pengeluaran,
      selisih: lapB.summary.selisih,
    });
    const textB = Buffer.from(pdfB.pdf).toString('latin1');
    expect(textB).toContain('Belanja Dapur Bersama');
    expect(textB).not.toContain('KANARI-PDF');
    expect(textB).not.toContain('123.456');

    // Audit event export mencatat via = 'pdf'.
    const audit = await h.admin.query<{ via: string }>(
      "select meta ->> 'via' as via from audit.events where event = 'export' order by id desc limit 1",
    );
    expect(audit.rows[0]?.via).toBe('pdf');
  });

  it('[B13] kalender arus kas sinkron dengan saldo operasional, menandai Kurang, dan terisolasi per ruang', async () => {
    const { accountId: bca } = await createAccount(nPribadi, {
      clientId: randomUUID(),
      name: 'BCA',
      pocket: 'operasional',
      walletType: 'bank',
      openingBalance: 1_000_000,
    });
    await createAccount(nBersama, {
      clientId: randomUUID(),
      name: 'Kas',
      pocket: 'operasional',
      walletType: 'bank',
      openingBalance: 5_000_000,
    });
    const catExpP = await pickCat(nPribadi, 'expense');

    // Tagihan Pribadi besar 1.500.000 jatuh tempo 3 hari lagi -> membuat saldo Pribadi Kurang (-500.000).
    const due3 = daysAgo(today, -3);
    const dueDay = Number(due3.slice(8, 10));
    await createBill(nPribadi, {
      clientId: randomUUID(),
      name: 'KANARI-TAGIHAN-PRIBADI',
      amount: 1_500_000,
      categoryId: catExpP,
      dayOfMonth: dueDay,
      startsOn: today,
      endsOn: null,
      accountId: bca,
    });

    const sts = await safeToSpend(nPribadi);
    const kalP = await loadKalender(nPribadi, 30);
    expect(kalP.startBalance).toBe(sts.operasional);
    expect(kalP.days).toHaveLength(30);
    expect(kalP.firstShortDay).toBe(due3);
    expect(kalP.lowestBalance).toBe(-500_000);
    expect(kalP.totalBillsAmount).toBe(1_500_000);
    expect(kalP.totalBillsCount).toBe(1);
    const dueRow = kalP.days.find((d) => d.day === due3);
    expect(dueRow?.bills[0]?.name).toBe('KANARI-TAGIHAN-PRIBADI');

    // Bersama (F) tidak pernah melihat tagihan Pribadi N.
    const kalB = await loadKalender(fBersama, 90);
    expect(kalB.startBalance).toBe(5_000_000);
    expect(kalB.totalBillsCount).toBe(0);
    expect(JSON.stringify(kalB)).not.toContain('KANARI-TAGIHAN-PRIBADI');

    // Orang luar tidak boleh membaca kalender Bersama -> not_found.
    const err = await loadKalender(
      { pools: h.pools, userId: luar.id, spaceId: nBersama.spaceId },
      30,
    ).catch((e: unknown) => toLedgerError(e));
    expect(err).toEqual({ code: 'not_found' });
  });

  it('[B13] deteksi langganan di loadRencana dan abaikan saran idempoten', async () => {
    const opened = monthsAgoDay(today, 3, 1);
    const { accountId: bcaId } = await createAccount(nPribadi, {
      clientId: randomUUID(),
      name: 'BCA',
      pocket: 'operasional',
      walletType: 'bank',
      openingBalance: 5_000_000,
    });
    await h.admin.query('update app.accounts set opened_on = $1::date where id = $2', [
      opened,
      bcaId,
    ]);
    const catExpP = await pickCat(nPribadi, 'expense');

    // 3 bulan berbeda dengan nominal sama persis (54.000) -> terdeteksi.
    for (const back of [2, 1, 0]) {
      const dt = back === 0 ? today : monthsAgoDay(today, back, 10);
      await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: bcaId,
        kind: 'expense',
        amount: 54_000,
        categoryId: catExpP,
        occurredOn: dt,
        description: back === 1 ? 'NETFLIX ' : 'Netflix',
      });
    }

    const r1 = await loadRencana(nPribadi);
    expect(r1.subscriptions).toHaveLength(1);
    expect(r1.subscriptions[0]).toMatchObject({
      name: 'Netflix',
      amount: 54_000,
      months: 3,
      categoryId: catExpP,
      accountId: bcaId,
    });

    // Bersama tidak melihat saran Pribadi N.
    const rB = await loadRencana(fBersama);
    expect(rB.subscriptions).toHaveLength(0);

    // Abaikan idempoten -> hilang dari loadRencana.
    await expect(
      dismissSubscription(nPribadi, { name: 'Netflix', amount: 54_000 }),
    ).resolves.toEqual({
      dismissed: true,
    });
    await expect(
      dismissSubscription(nPribadi, { name: 'NETFLIX', amount: 54_000 }),
    ).resolves.toEqual({
      dismissed: true,
    });
    const r2 = await loadRencana(nPribadi);
    expect(r2.subscriptions).toHaveLength(0);
  });
});
