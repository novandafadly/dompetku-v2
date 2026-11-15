import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pools } from '@/server/db';
import { toLedgerError } from '@/server/ledger/errors';
import {
  createLedgerHarness,
  memuatNominal,
  resetLedger,
  seedPersonas,
  type Persona,
} from '@/server/ledger/__int__/harness';
import { effectOnAccountVM } from '@/features/ledger/present';
import { loadDompetRiwayat } from '@/server/ledger/dompet';
import { listAccounts, listEntries, monthSummary } from '@/server/ledger/read';
import { loadSampah } from '@/server/ledger/sampah';
import { resolveSpace } from '@/server/ledger/space';
import { createDebt, loadDebtDetail, loadKontak, loadUtang, payDebt } from '@/server/ledger/utang';
import { createEntry, type LedgerCtx } from '@/server/ledger/write';

/**
 * Utang/piutang S11 (plan Task 5, K10) terhadap Postgres nyata lewat jalur TS: action (sesi di-mock
 * ke persona) → resolve ruang → Zod → wrapper `api.*` → pemetaan galat, dan loader. Definisi tes
 * T6–T9, S4, C3, C6, B10, I6, INT-12 di plan S11 K10.
 */

const session = vi.hoisted(() => ({ userId: '', pools: null as Pools | null }));
const refresh = vi.hoisted(() => vi.fn());

vi.mock('next/cache', () => ({ refresh, revalidatePath: vi.fn() }));
vi.mock('@/server/auth/next', () => ({
  requireDataUser: () => Promise.resolve({ userId: session.userId }),
  authService: () => ({ pools: session.pools }),
}));

const a = await import('../utang');
const { createAccountAction } = await import('../dompet');
const { voidEntryAction, restoreEntryAction } = await import('../entri');

const h = createLedgerHarness();
session.pools = h.pools;

afterAll(async () => {
  await h.close();
});

function must(p: Persona | null): Persona {
  if (!p) throw new Error('persona tidak ada');
  return p;
}

async function ctxOf(p: Persona, ruang: 'pribadi' | 'bersama'): Promise<LedgerCtx> {
  const { spaceId } = await resolveSpace(h.pools, p.id, ruang);
  return { pools: h.pools, userId: p.id, spaceId };
}

function ok<T>(r: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!r.ok) throw new Error(`gagal: ${r.error.code}`);
  return r.value;
}

async function wallet(
  name: string,
  openingBalance: number,
  pocket: 'operasional' | 'kantor' = 'operasional',
): Promise<string> {
  return ok(
    await createAccountAction('pribadi', {
      clientId: randomUUID(),
      name,
      pocket,
      walletType: 'bank',
      openingBalance,
    }),
  ).accountId;
}

async function balance(accountId: string): Promise<number> {
  const { rows } = await h.admin.query<{ b: number }>(
    `select coalesce(sum(l.amount), 0)::float8 as b
       from app.entry_lines l join app.entries e on e.id = l.entry_id
      where l.account_id = $1 and e.voided_at is null`,
    [accountId],
  );
  return rows[0]?.b ?? NaN;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await h.admin.query<{ n: number }>(
    `select count(*)::int as n from ${sql}`,
    params,
  );
  return rows[0]?.n ?? NaN;
}

async function today(): Promise<string> {
  const { rows } = await h.admin.query<{ d: string }>(
    "select to_char(app.today(), 'YYYY-MM-DD') as d",
  );
  return rows[0]?.d ?? '';
}

async function principalEntry(debtId: string) {
  const { rows } = await h.admin.query<{ id: string; occurred_on: string; version: number }>(
    `select id, occurred_on::text, version from app.entries
      where debt_id = $1 and kind = 'debt_principal'`,
    [debtId],
  );
  const r = rows[0];
  if (!r) throw new Error('entri pokok tidak ada');
  return r;
}

const PINJAM = 2_000_000;

describe('action Utang S11 terhadap DB', () => {
  let n: Persona;
  let f: Persona;
  let pribadi: LedgerCtx;
  let bca: string;

  beforeEach(async () => {
    await resetLedger(h);
    const ps = await seedPersonas(h, { farida: 'bergabung' });
    n = ps.n;
    f = must(ps.f);
    session.userId = n.id;
    pribadi = await ctxOf(n, 'pribadi');
    bca = await wallet('BCA', 1_000_000);
    refresh.mockClear();
  });

  async function pinjam(over: Partial<Parameters<typeof a.createDebtAction>[1]> = {}) {
    return ok(
      await a.createDebtAction('pribadi', {
        clientId: randomUUID(),
        direction: 'borrowed',
        principal: PINJAM,
        mode: 'baru',
        contactName: 'Budi',
        accountId: bca,
        title: 'Motor',
        ...over,
      }),
    );
  }

  async function bayar(debtId: string, amount: number, clientId = randomUUID()) {
    return a.payDebtAction('pribadi', { clientId, debtId, accountId: bca, amount });
  }

  it('mode baru: pokok masuk dompet, cicilan mengurangi saldo dan sisa (angka dari SQL)', async () => {
    const d = await pinjam();
    expect(d).toMatchObject({
      principal: PINJAM,
      paid: 0,
      remaining: PINJAM,
      paidPct: 0,
      settled: false,
      quick: { p25: 500_000, p50: 1_000_000, full: PINJAM },
      version: 1,
      replayed: false,
    });
    expect(d.entryId).not.toBeNull();
    expect(await balance(bca)).toBe(3_000_000);

    const p = ok(await bayar(d.debtId, 500_000));
    expect(p).toMatchObject({ paid: 500_000, remaining: 1_500_000, paidPct: 25, settled: false });
    expect(await balance(bca)).toBe(2_500_000);
    expect(refresh).toHaveBeenCalled();

    const u = await loadUtang(pribadi);
    expect(u.debts).toHaveLength(1);
    expect(u.debts[0]).toMatchObject({
      debtId: d.debtId,
      contactName: 'Budi',
      direction: 'borrowed',
      mode: 'baru',
      title: 'Motor',
      remaining: 1_500_000,
      paidPct: 25,
      quick: { p25: 375_000, p50: 750_000, full: 1_500_000 },
      accountId: bca,
      voidedAt: null,
    });
    expect(u.totals).toEqual({
      borrowed: { remaining: 1_500_000, contacts: 1 },
      lent: { remaining: 0, contacts: 0 },
    });
    expect(u.contacts).toEqual([
      {
        contactId: d.contactId,
        name: 'Budi',
        borrowedRemaining: 1_500_000,
        lentRemaining: 0,
        borrowedCount: 1,
        lentCount: 0,
      },
    ]);

    const det = await loadDebtDetail(pribadi, d.debtId);
    expect(det).toMatchObject({
      remaining: 1_500_000,
      principalEntryId: d.entryId,
      accountId: bca,
      accountName: 'BCA',
      voidEffects: [{ accountId: bca, accountName: 'BCA', amount: -1_500_000 }],
    });
    expect(det?.payments).toHaveLength(1);
    expect(det?.payments[0]).toMatchObject({ amount: 500_000, voided: false, accountName: 'BCA' });
    expect(det?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
  });

  it('[S4] [T6] ubah judul, catatan, kontak, dan nama kontak tanpa efek ke saldo, cicilan, sisa, pokok', async () => {
    const d = await pinjam();
    ok(await bayar(d.debtId, 500_000));
    const before = {
      saldo: await balance(bca),
      pokok: await principalEntry(d.debtId),
      cicilan: await count(`app.entries where kind = 'debt_payment'`),
      history: await count('app.entry_history'),
    };
    const sari = ok(
      await a.createContactAction('pribadi', { clientId: randomUUID(), name: 'Sari' }),
    );

    expect(
      ok(
        await a.updateDebtInfoAction('pribadi', {
          debtId: d.debtId,
          contactId: sari.contactId,
          title: 'Laptop',
          note: 'dibayar tiap gajian',
        }),
      ),
    ).toEqual({ debtId: d.debtId });
    ok(await a.renameContactAction('pribadi', { contactId: sari.contactId, name: 'Sari W' }));

    expect(await balance(bca)).toBe(before.saldo);
    expect(await principalEntry(d.debtId)).toEqual(before.pokok);
    expect(await count(`app.entries where kind = 'debt_payment'`)).toBe(before.cicilan);
    expect(await count('app.entry_history')).toBe(before.history);
    const det = await loadDebtDetail(pribadi, d.debtId);
    expect(det).toMatchObject({
      contactId: sari.contactId,
      contactName: 'Sari W',
      title: 'Laptop',
      note: 'dibayar tiap gajian',
      principal: PINJAM,
      paid: 500_000,
      remaining: 1_500_000,
    });

    // Ganti penuh: null mengosongkan.
    ok(
      await a.updateDebtInfoAction('pribadi', {
        debtId: d.debtId,
        contactId: sari.contactId,
        title: null,
        note: null,
      }),
    );
    expect(await loadDebtDetail(pribadi, d.debtId)).toMatchObject({ title: null, note: null });
  });

  it('[T7] bayar > sisa = payment_exceeds tanpa efek dan tanpa nominal; sisa untuk "Bayar sisa" dari data', async () => {
    const d = await pinjam();
    ok(await bayar(d.debtId, 500_000));
    const saldo = await balance(bca);
    const cicilan = await count(`app.entries where kind = 'debt_payment'`);

    const r = await bayar(d.debtId, 1_500_001);
    expect(r).toEqual({ ok: false, error: { code: 'payment_exceeds' } });
    expect(memuatNominal(r, 1_500_001)).toBe(false);
    expect(memuatNominal(r, 1_500_000)).toBe(false);
    expect(await balance(bca)).toBe(saldo);
    expect(await count(`app.entries where kind = 'debt_payment'`)).toBe(cicilan);
    expect(await count('app.idempotency_keys')).toBeGreaterThan(0);
    expect((await loadDebtDetail(pribadi, d.debtId))?.quick.full).toBe(1_500_000);

    // Lunas tepat sisa, lalu bayar apa pun = payment_exceeds.
    expect(ok(await bayar(d.debtId, 1_500_000))).toMatchObject({
      remaining: 0,
      settled: true,
      paidPct: 100,
      quick: { p25: null, p50: null, full: 0 },
    });
    expect(await bayar(d.debtId, 1)).toEqual({ ok: false, error: { code: 'payment_exceeds' } });
  });

  it('[T8] batal cicilan membalik saldo dan sisa, riwayat menandai batal; pulihkan mengembalikan', async () => {
    const d = await pinjam();
    const p = ok(await bayar(d.debtId, 400_000));
    expect(await balance(bca)).toBe(2_600_000);

    ok(
      await voidEntryAction('pribadi', {
        clientId: randomUUID(),
        entryId: p.entryId,
        expectedVersion: p.version,
      }),
    );
    expect(await balance(bca)).toBe(3_000_000);
    let det = await loadDebtDetail(pribadi, d.debtId);
    expect(det).toMatchObject({ paid: 0, remaining: PINJAM });
    expect(det?.payments[0]).toMatchObject({
      entryId: p.entryId,
      voided: true,
      voidedWithDebt: false,
      version: 2,
    });
    expect(det?.payments[0]?.voidedAt).toMatch(/\+07:00$/);

    // Loader lama mengenal kind baru (Transaksi, Sampah).
    const month = (await today()).slice(0, 7);
    const list = await listEntries(pribadi, { month });
    expect(list.find((e) => e.kind === 'debt_principal')).toMatchObject({
      amount: PINJAM,
      direction: 'in',
    });
    const sampah = await loadSampah(pribadi);
    expect(sampah.items.map((t) => t.entry)).toEqual([
      expect.objectContaining({ id: p.entryId, kind: 'debt_payment', direction: 'out' }),
    ]);

    ok(
      await restoreEntryAction('pribadi', {
        clientId: randomUUID(),
        entryId: p.entryId,
        expectedVersion: 2,
      }),
    );
    expect(await balance(bca)).toBe(2_600_000);
    det = await loadDebtDetail(pribadi, d.debtId);
    expect(det).toMatchObject({ paid: 400_000, remaining: 1_600_000 });

    // Pokok hanya lewat Hapus utang.
    expect(
      await voidEntryAction('pribadi', {
        clientId: randomUUID(),
        entryId: d.entryId ?? '',
        expectedVersion: 1,
      }),
    ).toEqual({ ok: false, error: { code: 'debt_principal_locked' } });

    // Pulihkan cicilan yang membuat Σ cicilan melebihi pokok = payment_exceeds, nol efek.
    ok(
      await voidEntryAction('pribadi', {
        clientId: randomUUID(),
        entryId: p.entryId,
        expectedVersion: 3,
      }),
    );
    ok(await bayar(d.debtId, 1_700_000));
    const saldo = await balance(bca);
    const r = await restoreEntryAction('pribadi', {
      clientId: randomUUID(),
      entryId: p.entryId,
      expectedVersion: 4,
    });
    expect(r).toEqual({ ok: false, error: { code: 'payment_exceeds' } });
    expect(memuatNominal(r, 400_000)).toBe(false);
    expect(await balance(bca)).toBe(saldo);
    expect(await loadDebtDetail(pribadi, d.debtId)).toMatchObject({
      paid: 1_700_000,
      remaining: 300_000,
    });
  });

  it('[T9] hapus utang = void atomik semua efek; pulihkan memulihkan (round-trip)', async () => {
    const d = await pinjam();
    const p1 = ok(await bayar(d.debtId, 300_000));
    const p2 = ok(await bayar(d.debtId, 200_000));
    ok(
      await voidEntryAction('pribadi', {
        clientId: randomUUID(),
        entryId: p2.entryId,
        expectedVersion: 1,
      }),
    );
    expect(await balance(bca)).toBe(2_700_000);

    const v = ok(await a.voidDebtAction('pribadi', { clientId: randomUUID(), debtId: d.debtId }));
    expect(v.effects).toEqual([{ accountId: bca, accountName: 'BCA', amount: -1_700_000 }]);
    expect([...v.affected].sort()).toEqual([d.entryId, p1.entryId].sort());
    expect(await balance(bca)).toBe(1_000_000);
    expect(await loadDebtDetail(pribadi, d.debtId)).toBeNull();
    const u = await loadUtang(pribadi);
    expect(u.debts[0]).toMatchObject({ debtId: d.debtId, remaining: 1_700_000 });
    expect(u.debts[0]?.voidedAt).toMatch(/\+07:00$/);
    expect(u.totals.borrowed).toEqual({ remaining: 0, contacts: 0 });
    // Sampah tidak memuat entri utang terhapus (ikut Hapus utang maupun cicilan yang dibatalkan
    // sendiri sebelumnya): pemulihan lewat segmen Utang (0131 trash_list).
    expect((await loadSampah(pribadi)).items).toEqual([]);

    // Cicilan utang terhapus tidak bisa dipulihkan sendiri, dan tidak bisa dibayar.
    expect(
      await restoreEntryAction('pribadi', {
        clientId: randomUUID(),
        entryId: p2.entryId,
        expectedVersion: 2,
      }),
    ).toEqual({ ok: false, error: { code: 'debt_deleted' } });
    expect(await bayar(d.debtId, 1)).toEqual({ ok: false, error: { code: 'debt_deleted' } });
    // Batalkan cicilan utang terhapus lewat jalur generik (versi terbaru) = debt_deleted.
    expect(
      await voidEntryAction('pribadi', {
        clientId: randomUUID(),
        entryId: p1.entryId,
        expectedVersion: 2,
      }),
    ).toEqual({ ok: false, error: { code: 'debt_deleted' } });
    // Ubah info utang terhapus = debt_deleted.
    expect(
      await a.updateDebtInfoAction('pribadi', {
        debtId: d.debtId,
        contactId: d.contactId,
        title: 'X',
        note: null,
      }),
    ).toEqual({ ok: false, error: { code: 'debt_deleted' } });
    // Hapus dua kali (tab lain) = conflict.
    expect(await a.voidDebtAction('pribadi', { clientId: randomUUID(), debtId: d.debtId })).toEqual(
      { ok: false, error: { code: 'conflict' } },
    );

    const r = ok(
      await a.restoreDebtAction('pribadi', { clientId: randomUUID(), debtId: d.debtId }),
    );
    expect(r).toMatchObject({
      paid: 300_000,
      remaining: 1_700_000,
      effects: [{ accountId: bca, accountName: 'BCA', amount: 1_700_000 }],
    });
    expect(await balance(bca)).toBe(2_700_000);
    // Cicilan yang dibatalkan sendiri tetap batal dan muncul lagi di Sampah.
    expect((await loadSampah(pribadi)).items.map((t) => t.entry.id)).toEqual([p2.entryId]);
    const det = await loadDebtDetail(pribadi, d.debtId);
    expect(det?.payments.map((x) => [x.entryId, x.voided])).toEqual(
      expect.arrayContaining([
        [p1.entryId, false],
        [p2.entryId, true],
      ]),
    );
  });

  it('mode berjalan: tanpa entri, saldo dan Σ pemasukan/pengeluaran tetap (K2, I6); piutang baru juga bukan pemasukan', async () => {
    const month = (await today()).slice(0, 7);
    const sebelum = await monthSummary(pribadi, month);
    const d = ok(
      await a.createDebtAction('pribadi', {
        clientId: randomUUID(),
        direction: 'lent',
        principal: 750_000,
        mode: 'berjalan',
        contactName: 'Andi',
      }),
    );
    expect(d.entryId).toBeNull();
    expect(await count('app.entries where debt_id = $1', [d.debtId])).toBe(0);
    expect(await balance(bca)).toBe(1_000_000);
    expect((await loadDebtDetail(pribadi, d.debtId))?.accountId).toBeNull();

    ok(
      await a.payDebtAction('pribadi', {
        clientId: randomUUID(),
        debtId: d.debtId,
        accountId: bca,
        amount: 250_000,
      }),
    );
    expect(await balance(bca)).toBe(1_250_000);
    const pinjamBaru = await pinjam({ contactName: 'Citra' });
    ok(await bayar(pinjamBaru.debtId, 100_000));
    expect(await monthSummary(pribadi, month)).toEqual(sebelum);
  });

  it('riwayat dompet: efek pokok dan cicilan utang/piutang = saldo (empat arah)', async () => {
    const u = await pinjam();
    ok(await bayar(u.debtId, 300_000));
    const p = ok(
      await a.createDebtAction('pribadi', {
        clientId: randomUUID(),
        direction: 'lent',
        principal: 800_000,
        mode: 'baru',
        contactName: 'Andi',
        accountId: bca,
      }),
    );
    ok(await bayar(p.debtId, 200_000));
    const saldo = 1_000_000 + PINJAM - 300_000 - 800_000 + 200_000;
    expect(await balance(bca)).toBe(saldo);

    const r = await loadDompetRiwayat(pribadi, bca, 50, await listAccounts(pribadi));
    const opening = (r?.opening ?? []).reduce((s, e) => s + e.amount, 0);
    const rows = (r?.entries ?? []).map((e) => effectOnAccountVM(e, bca).value);
    expect([...rows].sort((x, y) => x - y)).toEqual([-800_000, -300_000, 200_000, PINJAM]);
    expect(opening + rows.reduce((s, v) => s + v, 0)).toBe(saldo);
    expect(r?.account.balance).toBe(saldo);
  });

  it('[T7] pintasan 25%/50% null bila hasilnya 0 (tanpa "Rp 0"), full = sisa', async () => {
    const d = ok(
      await a.createDebtAction('pribadi', {
        clientId: randomUUID(),
        direction: 'lent',
        principal: 3,
        mode: 'berjalan',
        contactName: 'Kecil',
      }),
    );
    expect(d.quick).toEqual({ p25: null, p50: 1, full: 3 });
    const p = ok(await bayar(d.debtId, 2));
    expect(p.quick).toEqual({ p25: null, p50: null, full: 1 });
    expect((await loadUtang(pribadi)).debts[0]?.quick).toEqual({ p25: null, p50: null, full: 1 });
    expect((await loadDebtDetail(pribadi, d.debtId))?.quick).toEqual({
      p25: null,
      p50: null,
      full: 1,
    });
  });

  it('[C6] Tambah utang ganda (clientId sama) = satu utang, satu kontak, satu entri pokok', async () => {
    const input = {
      clientId: randomUUID(),
      direction: 'borrowed' as const,
      principal: PINJAM,
      mode: 'baru' as const,
      contactName: 'Budi',
      accountId: bca,
    };
    const [x, y] = await Promise.all([
      a.createDebtAction('pribadi', input),
      a.createDebtAction('pribadi', input),
    ]);
    const both = [ok(x), ok(y)];
    expect(both[0]?.debtId).toBe(both[1]?.debtId);
    expect(both.map((b) => b.replayed).sort()).toEqual([false, true]);
    expect(await count('app.debts')).toBe(1);
    expect(await count('app.contacts')).toBe(1);
    expect(await count(`app.entries where kind = 'debt_principal'`)).toBe(1);
    expect(await balance(bca)).toBe(3_000_000);
    // clientId sama, isi beda = idem_mismatch.
    expect(await a.createDebtAction('pribadi', { ...input, principal: 1 })).toEqual({
      ok: false,
      error: { code: 'idem_mismatch' },
    });
  });

  it('[C3] dua pembayaran paralel melebihi sisa = satu ditolak; [C6] klik ganda = satu entri', async () => {
    const d = await pinjam();
    const rs = await Promise.allSettled([
      payDebt(pribadi, {
        clientId: randomUUID(),
        debtId: d.debtId,
        accountId: bca,
        amount: 1_200_000,
      }),
      payDebt(pribadi, {
        clientId: randomUUID(),
        debtId: d.debtId,
        accountId: bca,
        amount: 1_200_000,
      }),
    ]);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = rs.find((r) => r.status === 'rejected');
    expect(toLedgerError(rejected?.reason)).toEqual({ code: 'payment_exceeds' });
    expect(await count(`app.entries where kind = 'debt_payment'`)).toBe(1);

    const clientId = randomUUID();
    const [x, y] = await Promise.all([
      bayar(d.debtId, 100_000, clientId),
      bayar(d.debtId, 100_000, clientId),
    ]);
    const both = [ok(x), ok(y)];
    expect(both[0]?.entryId).toBe(both[1]?.entryId);
    expect(both.map((b) => b.replayed).sort()).toEqual([false, true]);
    expect(await count(`app.entries where kind = 'debt_payment'`)).toBe(2);
    expect(await balance(bca)).toBe(3_000_000 - 1_300_000);
  });

  it('INT-12: kegagalan di tengah pay_debt = rollback utuh; clientId sama lalu berhasil sekali', async () => {
    const d = await pinjam();
    const saldo = await balance(bca);
    await h.admin
      .query(`create function public.tes_gagal_cicilan() returns trigger language plpgsql as $$
      begin
        if exists (select 1 from app.entries e where e.id = new.entry_id and e.kind = 'debt_payment') then
          raise exception using errcode = 'P0001', message = 'fail_after';
        end if;
        return new;
      end $$`);
    await h.admin.query(`create trigger tes_gagal_cicilan after insert on app.entry_lines
      for each row execute function public.tes_gagal_cicilan()`);
    const clientId = randomUUID();
    try {
      await expect(
        payDebt(pribadi, { clientId, debtId: d.debtId, accountId: bca, amount: 300_000 }),
      ).rejects.toMatchObject({ code: 'P0001' });
    } finally {
      await h.admin.query('drop trigger tes_gagal_cicilan on app.entry_lines');
      await h.admin.query('drop function public.tes_gagal_cicilan()');
    }
    expect(await count(`app.entries where kind = 'debt_payment'`)).toBe(0);
    expect(await balance(bca)).toBe(saldo);
    expect((await loadDebtDetail(pribadi, d.debtId))?.remaining).toBe(PINJAM);

    const r = await payDebt(pribadi, {
      clientId,
      debtId: d.debtId,
      accountId: bca,
      amount: 300_000,
    });
    expect(r.replayed).toBe(false);
    expect(await count(`app.entries where kind = 'debt_payment'`)).toBe(1);
  });

  it('[B10] Bersama ditolak di action (tanpa DB) dan di DB (wrapper langsung); tidak ada baris', async () => {
    const r = await a.createDebtAction('bersama', {
      clientId: randomUUID(),
      direction: 'borrowed',
      principal: 100_000,
      mode: 'berjalan',
      contactName: 'Budi',
    });
    expect(r).toEqual({ ok: false, error: { code: 'debt_personal_only' } });
    expect(await a.createContactAction('bersama', { clientId: randomUUID(), name: 'X' })).toEqual({
      ok: false,
      error: { code: 'debt_personal_only' },
    });
    const bersama = await ctxOf(n, 'bersama');
    const err = await createDebt(bersama, {
      clientId: randomUUID(),
      direction: 'borrowed',
      principal: 100_000,
      mode: 'berjalan',
      contactName: 'Budi',
    }).catch((e: unknown) => e);
    expect(toLedgerError(err)).toEqual({ code: 'debt_personal_only' });
    expect(await count('app.debts')).toBe(0);
    expect(await count('app.contacts')).toBe(0);
  });

  it('Farida tidak melihat dan tidak bisa menyentuh utang Novanda; rute Bersama Novanda juga tidak', async () => {
    const d = await pinjam({ contactName: 'KANARI-KONTAK-N' });
    session.userId = f.id;
    const fPribadi = await ctxOf(f, 'pribadi');
    expect(await loadUtang(fPribadi)).toEqual({
      debts: [],
      totals: { borrowed: { remaining: 0, contacts: 0 }, lent: { remaining: 0, contacts: 0 } },
      contacts: [],
    });
    expect(await loadKontak(fPribadi)).toEqual([]);
    expect(await loadDebtDetail(fPribadi, d.debtId)).toBeNull();
    const fWallet = await wallet('BCA F', 5_000_000);
    const r = await a.payDebtAction('pribadi', {
      clientId: randomUUID(),
      debtId: d.debtId,
      accountId: fWallet,
      amount: 1_000,
    });
    expect(r).toEqual({ ok: false, error: { code: 'not_found' } });
    expect(await a.voidDebtAction('pribadi', { clientId: randomUUID(), debtId: d.debtId })).toEqual(
      { ok: false, error: { code: 'not_found' } },
    );
    expect(
      await a.renameContactAction('pribadi', { contactId: d.contactId, name: 'Diubah' }),
    ).toEqual({ ok: false, error: { code: 'not_found' } });

    session.userId = n.id;
    expect(await loadDebtDetail(await ctxOf(n, 'bersama'), d.debtId)).toBeNull();
    expect(await loadDebtDetail(pribadi, 'bukan-uuid')).toBeNull();
    expect(await balance(bca)).toBe(3_000_000);
  });

  it('kontak: nama ganda tanpa beda huruf, arsip, kontak terarsip ditolak untuk utang baru; Kantor dan tanggal sebelum mulai ditolak', async () => {
    const k = ok(await a.createContactAction('pribadi', { clientId: randomUUID(), name: 'Budi' }));
    expect(
      await a.createContactAction('pribadi', { clientId: randomUUID(), name: ' budi ' }),
    ).toEqual({
      ok: false,
      error: { code: 'contact_name_taken' },
    });
    expect(
      await a.createDebtAction('pribadi', {
        clientId: randomUUID(),
        direction: 'lent',
        principal: 10_000,
        mode: 'berjalan',
        contactName: 'BUDI',
      }),
    ).toEqual({ ok: false, error: { code: 'contact_name_taken' } });
    expect(await a.createContactAction('pribadi', { clientId: randomUUID(), name: '  ' })).toEqual({
      ok: false,
      error: { code: 'invalid', field: 'name' },
    });

    const d = await pinjam({ contactName: undefined, contactId: k.contactId });
    ok(await a.archiveContactAction('pribadi', { contactId: k.contactId }));
    ok(await a.archiveContactAction('pribadi', { contactId: k.contactId }));
    expect(await loadKontak(pribadi)).toEqual([]);
    expect((await loadDebtDetail(pribadi, d.debtId))?.contactArchived).toBe(true);
    // Utang lama tetap bisa dibayar.
    ok(await bayar(d.debtId, 1_000));
    // Utang lama pada kontak terarsip tetap bisa diubah judulnya (kontak sama ditulis ulang).
    ok(
      await a.updateDebtInfoAction('pribadi', {
        debtId: d.debtId,
        contactId: k.contactId,
        title: 'Judul baru',
        note: null,
      }),
    );
    expect(
      await a.createDebtAction('pribadi', {
        clientId: randomUUID(),
        direction: 'lent',
        principal: 10_000,
        mode: 'berjalan',
        contactId: k.contactId,
      }),
    ).toEqual({ ok: false, error: { code: 'contact_archived' } });
    expect(
      await a.renameContactAction('pribadi', { contactId: k.contactId, name: 'Budi Baru' }),
    ).toEqual({ ok: false, error: { code: 'contact_archived' } });

    const kantor = await wallet('Kantor', 500_000, 'kantor');
    const kr = await a.createDebtAction('pribadi', {
      clientId: randomUUID(),
      direction: 'borrowed',
      principal: 10_000,
      mode: 'baru',
      contactName: 'Fajar',
      accountId: kantor,
    });
    expect(kr).toEqual({ ok: false, error: { code: 'debt_account_kantor' } });

    const berjalan = ok(
      await a.createDebtAction('pribadi', {
        clientId: randomUUID(),
        direction: 'borrowed',
        principal: 10_000,
        mode: 'berjalan',
        contactName: 'Gita',
      }),
    );
    const t = await today();
    const kemarin = new Date(Date.parse(`${t}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    expect(
      await a.payDebtAction('pribadi', {
        clientId: randomUUID(),
        debtId: berjalan.debtId,
        accountId: bca,
        amount: 1_000,
        occurredOn: kemarin,
      }),
    ).toEqual({ ok: false, error: { code: 'payment_before_opened' } });
  });

  it('piutang baru yang membuat saldo negatif = saldo_negatif; allowNegative menyimpan', async () => {
    const input = {
      clientId: randomUUID(),
      direction: 'lent' as const,
      principal: 1_500_000,
      mode: 'baru' as const,
      contactName: 'Hadi',
      accountId: bca,
    };
    const r = await a.createDebtAction('pribadi', input);
    expect(r).toEqual({ ok: false, error: { code: 'saldo_negatif' } });
    expect(memuatNominal(r, 1_500_000)).toBe(false);
    expect(await count('app.debts')).toBe(0);
    expect(await count('app.contacts')).toBe(0);
    ok(await a.createDebtAction('pribadi', { ...input, allowNegative: true }));
    expect(await balance(bca)).toBe(-500_000);
  });

  it('[S12 K5] batal cicilan piutang yang membuat saldo negatif = saldo_negatif; allowNegative (clientId sama) membatalkan', async () => {
    const piutang = ok(
      await a.createDebtAction('pribadi', {
        clientId: randomUUID(),
        direction: 'lent',
        principal: 600_000,
        mode: 'baru',
        contactName: 'Hadi',
        accountId: bca,
      }),
    );
    const terima = ok(await bayar(piutang.debtId, 600_000));
    const { rows } = await h.admin.query<{ id: string }>(
      `select id from app.categories
        where space_id = $1 and type = 'expense' and parent_id is null order by sort_order limit 1`,
      [pribadi.spaceId],
    );
    await createEntry(pribadi, {
      clientId: randomUUID(),
      accountId: bca,
      kind: 'expense',
      amount: 700_000,
      categoryId: rows[0]?.id ?? '',
    });
    expect(await balance(bca)).toBe(300_000);

    const input = {
      clientId: randomUUID(),
      entryId: terima.entryId,
      expectedVersion: terima.version,
    };
    const ditolak = await voidEntryAction('pribadi', input);
    expect(ditolak).toEqual({ ok: false, error: { code: 'saldo_negatif' } });
    expect(memuatNominal(ditolak, 600_000)).toBe(false);
    // Ditolak = tidak ada efek: saldo dan sisa tetap.
    expect(await balance(bca)).toBe(300_000);
    expect(await loadDebtDetail(pribadi, piutang.debtId)).toMatchObject({ remaining: 0 });

    ok(await voidEntryAction('pribadi', { ...input, allowNegative: true }));
    expect(await balance(bca)).toBe(-300_000);
    expect(await loadDebtDetail(pribadi, piutang.debtId)).toMatchObject({
      paid: 0,
      remaining: 600_000,
    });
  });
});
