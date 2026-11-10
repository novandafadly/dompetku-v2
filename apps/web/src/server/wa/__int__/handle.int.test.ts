import { createHash, randomUUID } from 'node:crypto';
import { formatRupiah } from '@dompetku/domain';
import type pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPools, withAnon, withUser, type Pools } from '../../db';
import {
  createLedgerHarness,
  memuatNominal,
  resetLedger,
  seedPersonas,
  spaceIdOf,
  type Persona,
} from '../../ledger/__int__/harness';
import {
  archiveAccount,
  createAccount,
  createEntry,
  updateEntry,
  type LedgerCtx,
} from '../../ledger/write';
import type { WaEnv } from '../config';
import {
  createWaDeps,
  handleInbound,
  REPLY,
  WA_CLIENT_NAMESPACE,
  type WaDeps,
  type WaLog,
} from '../handle';
import type { InboundMessage, WaTransport } from '../transport';
import { uuidV5 } from '../uuid';

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const N_PHONE = '+6281234567890';
const N_FROM = '6281234567890@c.us';
const F_PHONE = '+6285711112222';
const F_FROM = '6285711112222@c.us';
const ASING_FROM = '6289900001111@c.us';
const ASING_PHONE = '+6289900001111';
const HOUR = 3_600_000;

const ENV: WaEnv = {
  webhookSecret: 'rahasia-webhook-1234',
  openwaUrl: 'http://127.0.0.1:2785',
  apiKey: 'kunci',
  session: 'sesi',
  maxAmount: 100_000_000,
  ratePerMin: 30,
  botNumber: null,
};

interface Sent {
  to: string;
  text: string;
}

interface Rig {
  deps: WaDeps;
  sent: Sent[];
  log: ReturnType<typeof vi.fn<WaLog>>;
  sendText: ReturnType<typeof vi.fn<WaTransport['sendText']>>;
  clock: { advance(ms: number): void };
}

function rig(opts: { pools?: Pools; env?: Partial<WaEnv> } = {}): Rig {
  const sent: Sent[] = [];
  let t = 1_700_000_000_000;
  const sendText = vi.fn<WaTransport['sendText']>((to, text) => {
    sent.push({ to, text });
    return Promise.resolve();
  });
  const transport: WaTransport = {
    verify: () => true,
    toInbound: () => null,
    sendText,
  };
  const log = vi.fn<WaLog>();
  const deps: WaDeps = {
    ...createWaDeps(opts.pools ?? h.pools, transport, { ...ENV, ...opts.env }, () => t),
    log,
  };
  return {
    deps,
    sent,
    log,
    sendText,
    clock: {
      advance(ms) {
        t += ms;
      },
    },
  };
}

function msg(text: string | null, over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    messageId: `true_${N_FROM}_${randomUUID()}`,
    from: N_FROM,
    senderPhone: null,
    chatType: 'private',
    fromMe: false,
    text,
    ...over,
  };
}

function must(p: Persona | null): Persona {
  if (!p) throw new Error('persona tidak ada');
  return p;
}

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function createCode(p: Persona): Promise<string> {
  return withUser(h.pools.app, p.id, async (c) => {
    const { rows } = await c.query<{ r: { code: string } }>(
      'select api.wa_create_link_code() as r',
    );
    const code = rows[0]?.r.code;
    if (!code) throw new Error('kode tidak terbuat');
    return code;
  });
}

async function linkDirect(p: Persona, phone: string): Promise<void> {
  const code = await createCode(p);
  const uid = await withAnon(h.pools.app, async (c) => {
    const { rows } = await c.query<{ r: string | null }>(
      'select api.wa_confirm_link($1, $2) as r',
      [code, phone],
    );
    return rows[0]?.r ?? null;
  });
  if (uid !== p.id) throw new Error('gagal menghubungkan');
}

async function resolve(phone: string): Promise<string | null> {
  return withAnon(h.pools.app, async (c) => {
    const { rows } = await c.query<{ r: string | null }>('select api.wa_resolve_sender($1) as r', [
      phone,
    ]);
    return rows[0]?.r ?? null;
  });
}

interface EntryRow {
  id: string;
  space_id: string;
  kind: string;
  amount: number;
  category_name: string | null;
  category_type: string | null;
  description: string | null;
  account_id: string;
  voided_at: Date | null;
  version: number;
}

/** Entri income/expense (tanpa saldo awal), dibaca superuser. */
async function entries(): Promise<EntryRow[]> {
  const { rows } = await h.admin.query<EntryRow>(
    `select e.id, e.space_id, e.kind::text, abs(l.amount)::int as amount, c.name as category_name,
            c.type::text as category_type, e.description, l.account_id, e.voided_at, e.version
       from app.entries e
       join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
       left join app.categories c on c.id = e.category_id
      where e.kind in ('income', 'expense')
      order by e.created_at, e.id`,
  );
  return rows;
}

async function messageRow(messageId: string) {
  const { rows } = await h.admin.query<{ status: string; entry_id: string | null }>(
    'select status, entry_id from app.wa_messages where message_id = $1',
    [sha(messageId)],
  );
  return rows[0] ?? null;
}

async function backdate(messageId: string, interval: string): Promise<void> {
  await h.admin.query(
    `update app.wa_messages set created_at = created_at - $2::interval where message_id = $1`,
    [sha(messageId), interval],
  );
}

async function wallet(
  ctx: LedgerCtx,
  pocket: 'operasional' | 'tabungan' | 'kantor' = 'operasional',
  name = `Dompet ${pocket} ${randomUUID().slice(0, 4)}`,
  openingBalance = 1_000_000,
) {
  const { accountId } = await createAccount(ctx, {
    clientId: randomUUID(),
    name,
    pocket,
    walletType: 'cash',
    openingBalance,
  });
  return accountId;
}

async function nameOf(accountId: string): Promise<string> {
  const { rows } = await h.admin.query<{ name: string }>(
    'select name from app.accounts where id = $1',
    [accountId],
  );
  return rows[0]?.name ?? '?';
}

/** Pool `dompetku_web` terpisah yang gagal (galat koneksi 08006) pada SQL yang cocok. */
function failingPools(match: RegExp, times: number): Pools & { end(): Promise<void> } {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL wajib diisi');
  const pools = createPools(url);
  let left = times;
  const connect = pools.app.connect.bind(pools.app);
  const app = Object.assign(Object.create(pools.app) as pg.Pool, {
    connect: async () => {
      const client = await connect();
      const query = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
      const release = client.release.bind(client);
      Object.assign(client, {
        query: (...a: unknown[]) => {
          if (typeof a[0] === 'string' && match.test(a[0]) && left > 0) {
            left -= 1;
            return Promise.reject(
              Object.assign(new Error('connection failure'), { code: '08006' }),
            );
          }
          return query(...a);
        },
        release: (...a: unknown[]) => {
          Object.assign(client, { query, release });
          release(...(a as [boolean?]));
        },
      });
      return client;
    },
  });
  return {
    auth: pools.auth,
    app,
    async end() {
      await Promise.all([pools.app.end(), pools.auth.end()]);
    },
  };
}

describe('handleInbound (Postgres sungguhan)', () => {
  let n: Persona;
  let f: Persona;
  let nPribadi: LedgerCtx;
  let nBersama: LedgerCtx;
  let nAccount: string;

  beforeEach(async () => {
    await resetLedger(h);
    const personas = await seedPersonas(h, { farida: 'bergabung' });
    n = personas.n;
    f = must(personas.f);
    nPribadi = { pools: h.pools, userId: n.id, spaceId: await spaceIdOf(h, n.id, 'personal') };
    nBersama = { pools: h.pools, userId: n.id, spaceId: await spaceIdOf(h, n.id, 'shared') };
    nAccount = await wallet(nPribadi);
    await linkDirect(n, N_PHONE);
  });

  it('nomor terhubung + "25rb makan siang" → satu pengeluaran Rp25.000 di Pribadi, balasan ✅', async () => {
    const r = rig();
    await handleInbound(r.deps, msg('25rb makan siang'));

    const rows = await entries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      space_id: nPribadi.spaceId,
      kind: 'expense',
      amount: 25_000,
      category_name: 'Makan Siang & Minum',
      description: 'makan siang',
      account_id: nAccount,
      voided_at: null,
    });
    expect(r.sent).toEqual([
      {
        to: N_PHONE,
        text: `✅ Makan Siang & Minum ${formatRupiah(25_000)} · Pribadi · ${await nameOf(nAccount)} · ketik batal untuk membatalkan`,
      },
    ]);
  });

  it('kamus didahulukan dari riwayat; tanpa kecocokan kamus = saran teratas (riwayat)', async () => {
    const { rows } = await h.admin.query<{ id: string }>(
      `select id from app.categories where space_id = $1 and name = 'Kopi & Camilan'`,
      [nPribadi.spaceId],
    );
    const kopi = rows[0]?.id;
    if (!kopi) throw new Error('kategori tidak ada');
    for (let i = 0; i < 5; i++) {
      await createEntry(nPribadi, {
        clientId: randomUUID(),
        accountId: nAccount,
        kind: 'expense',
        amount: 25_000,
        categoryId: kopi,
      });
    }
    const r = rig();
    await handleInbound(r.deps, msg('25rb makan siang'));
    await handleInbound(r.deps, msg('25rb sesuatu'));
    const wa = (await entries()).slice(5);
    expect(wa.map((e) => e.category_name)).toEqual(['Makan Siang & Minum', 'Kopi & Camilan']);
  });

  it('clientId entri = uuidV5 dari hash id pesan; id mentah tidak disimpan', async () => {
    const r = rig();
    const m = msg('+5jt gaji');
    await handleInbound(r.deps, m);
    const row = await messageRow(m.messageId);
    expect(row).toMatchObject({ status: 'recorded' });
    const { rows } = await h.admin.query<{ n: number }>(
      `select count(*)::int as n from app.wa_messages where message_id like '%' || $1 || '%'`,
      ['6281234567890'],
    );
    expect(rows[0]?.n).toBe(0);
    const idem = await h.admin.query<{ op: string }>(
      'select op from app.idempotency_keys where user_id = $1 and client_id = $2',
      [n.id, uuidV5(WA_CLIENT_NAMESPACE, sha(m.messageId))],
    );
    expect(idem.rows).toEqual([{ op: 'create_entry' }]);
    const [e] = await entries();
    expect(e).toMatchObject({ kind: 'income', amount: 5_000_000, category_name: 'Gaji' });
    expect(r.sent[0]?.text).toBe(
      `✅ Pemasukan · Gaji ${formatRupiah(5_000_000)} · Pribadi · ${await nameOf(nAccount)} · ketik batal untuk membatalkan`,
    );
  });

  it('pesan identik dua kali berurutan → tepat satu entri, kiriman kedua tanpa balasan', async () => {
    const r = rig();
    const m = msg('25rb makan siang');
    await handleInbound(r.deps, m);
    await handleInbound(r.deps, m);
    expect(await entries()).toHaveLength(1);
    expect(r.sent).toHaveLength(1);
    expect(r.log).toHaveBeenCalledWith('duplicate');
  });

  it('pesan identik dua kali bersamaan (Promise.all) → tepat satu entri dan satu balasan', async () => {
    const r = rig();
    const m = msg('30rb kopi');
    await Promise.all([handleInbound(r.deps, m), handleInbound(r.deps, m)]);
    expect(await entries()).toHaveLength(1);
    expect(r.sent).toHaveLength(1);
  });

  it('"batal" dalam 10 menit → entri void, balasan ↩️', async () => {
    const r = rig();
    await handleInbound(r.deps, msg('25rb makan siang'));
    await handleInbound(r.deps, msg('batal'));
    const [e] = await entries();
    expect(e?.voided_at).not.toBeNull();
    expect(r.sent[1]?.text).toBe(`↩️ Dibatalkan: Makan Siang & Minum ${formatRupiah(25_000)}`);
  });

  it('"batal" kedua tidak membatalkan catatan yang lebih lama', async () => {
    const r = rig();
    await handleInbound(r.deps, msg('25rb makan siang'));
    await handleInbound(r.deps, msg('30rb kopi'));
    await handleInbound(r.deps, msg('batal'));
    await handleInbound(r.deps, msg('batal'));
    const rows = await entries();
    expect(rows.map((x) => [x.amount, x.voided_at === null])).toEqual([
      [25_000, true],
      [30_000, false],
    ]);
    expect(r.sent[3]?.text).toBe(REPLY.cancelUnavailable);
  });

  it('"batal" saat catatan yang lebih baru masih pending → tidak ada yang dibatalkan', async () => {
    const r = rig();
    await handleInbound(r.deps, msg('25rb makan siang'));
    const flaky = failingPools(/api\.create_entry/, 1);
    try {
      const m2 = msg('30rb kopi');
      await handleInbound(rig({ pools: flaky }).deps, m2);
      expect(await messageRow(m2.messageId)).toMatchObject({ status: 'pending' });
    } finally {
      await flaky.end();
    }
    const b = msg('batal');
    await handleInbound(r.deps, b);
    const rows = await entries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 25_000, voided_at: null, version: 1 });
    expect(r.sent.at(-1)?.text).toBe(REPLY.cancelUnavailable);
    expect(await messageRow(b.messageId)).toMatchObject({ status: 'rejected', entry_id: null });
  });

  it('finish gagal sesudah createEntry, lalu "batal" → tidak ada yang dibatalkan', async () => {
    const r = rig();
    await handleInbound(r.deps, msg('25rb makan siang'));
    const flaky = failingPools(/api\.wa_finish_message/, 1);
    try {
      const rf = rig({ pools: flaky });
      const m2 = msg('30rb kopi');
      await handleInbound(rf.deps, m2);
      expect(rf.log).toHaveBeenCalledWith('finish_failed', '08006');
      expect(rf.sent[0]?.text).toMatch(/^✅ /);
      expect(await messageRow(m2.messageId)).toMatchObject({ status: 'pending', entry_id: null });
    } finally {
      await flaky.end();
    }
    await handleInbound(r.deps, msg('batal'));
    const rows = await entries();
    expect(rows.map((x) => [x.amount, x.voided_at === null])).toEqual([
      [25_000, true],
      [30_000, true],
    ]);
    expect(r.sent.at(-1)?.text).toBe(REPLY.cancelUnavailable);
  });

  it('"batal" sesudah 10 menit → tidak ada perubahan, balasan menunjuk ke app', async () => {
    const r = rig();
    const m = msg('25rb makan siang');
    await handleInbound(r.deps, m);
    await backdate(m.messageId, '11 minutes');
    await handleInbound(r.deps, msg('batal'));
    const [e] = await entries();
    expect(e?.voided_at).toBeNull();
    expect(e?.version).toBe(1);
    expect(r.sent[1]?.text).toBe(REPLY.cancelUnavailable);
    expect(REPLY.cancelUnavailable).toMatch(/app/);
  });

  it('"batal" sesudah entri diubah di app → tidak ada perubahan, balasan menunjuk ke app', async () => {
    const r = rig();
    await handleInbound(r.deps, msg('25rb makan siang'));
    const [e0] = await entries();
    if (!e0) throw new Error('entri tidak ada');
    await updateEntry(nPribadi, {
      clientId: randomUUID(),
      entryId: e0.id,
      expectedVersion: 1,
      accountId: nAccount,
      amount: 27_000,
      categoryId: null,
      occurredOn: null,
      description: 'diubah',
      reimbursable: false,
    });
    await handleInbound(r.deps, msg('batal'));
    const [e] = await entries();
    expect(e).toMatchObject({ voided_at: null, version: 2, amount: 27_000 });
    expect(r.sent[1]?.text).toBe(REPLY.cancelUnavailable);
  });

  it('webhook ulang untuk pesan yang sudah dibatalkan → tidak ada entri baru dan tidak ada balasan', async () => {
    const r = rig();
    const m = msg('25rb makan siang');
    const b = msg('batal');
    await handleInbound(r.deps, m);
    await handleInbound(r.deps, b);
    expect(r.sent).toHaveLength(2);
    await handleInbound(r.deps, m);
    await handleInbound(r.deps, b);
    await backdate(m.messageId, '1 hour');
    await backdate(b.messageId, '1 hour');
    await handleInbound(r.deps, m);
    await handleInbound(r.deps, b);
    const rows = await entries();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.voided_at).not.toBeNull();
    expect(r.sent).toHaveLength(2);
  });

  it('"b 80rb belanja" → ruang Bersama', async () => {
    const acc = await wallet(nBersama);
    const r = rig();
    await handleInbound(r.deps, msg('b 80rb belanja'));
    const [e] = await entries();
    expect(e).toMatchObject({
      space_id: nBersama.spaceId,
      kind: 'expense',
      amount: 80_000,
      account_id: acc,
      category_type: 'expense',
    });
    const { rows } = await h.admin.query<{ space_id: string }>(
      'select c.space_id from app.entries e join app.categories c on c.id = e.category_id where e.id = $1',
      [e?.id],
    );
    expect(rows[0]?.space_id).toBe(nBersama.spaceId);
    expect(r.sent[0]?.text).toBe(
      `✅ ${e?.category_name ?? '?'} ${formatRupiah(80_000)} · Bersama · ${await nameOf(acc)} · ketik batal untuk membatalkan`,
    );
  });

  it('ruang tanpa dompet → ditolak dengan balasan jelas', async () => {
    const r = rig();
    const m = msg('b 80rb belanja');
    await handleInbound(r.deps, m);
    expect(await entries()).toHaveLength(0);
    expect(r.sent[0]?.text).toBe('❌ Belum ada dompet aktif di ruang Bersama. Buka app dulu.');
    expect(await messageRow(m.messageId)).toMatchObject({ status: 'rejected' });
  });

  it('dompet kantor tidak pernah jadi bawaan: Pribadi hanya kantor → ditolak', async () => {
    const fPribadi = {
      pools: h.pools,
      userId: f.id,
      spaceId: await spaceIdOf(h, f.id, 'personal'),
    };
    await wallet(fPribadi, 'kantor');
    await linkDirect(f, F_PHONE);
    const r = rig();
    await handleInbound(r.deps, msg('25rb makan siang', { from: F_FROM }));
    expect(await entries()).toHaveLength(0);
    expect(r.sent).toEqual([
      { to: F_PHONE, text: '❌ Belum ada dompet aktif di ruang Pribadi. Buka app dulu.' },
    ]);
  });

  it('saldo tidak cukup → tidak ada entri, balasan menunjuk ke app', async () => {
    const r = rig();
    const m = msg('2jt makan');
    await handleInbound(r.deps, m);
    expect(await entries()).toHaveLength(0);
    expect(r.sent[0]?.text).toBe(REPLY.insufficient(await nameOf(nAccount)));
    expect(await messageRow(m.messageId)).toMatchObject({ status: 'rejected' });
  });

  it('nomor tidak terhubung → tidak ada baris ledger; balasan tautan maksimum sekali per jam', async () => {
    const r = rig();
    const before = await h.admin.query<{ n: number }>('select count(*)::int as n from app.entries');
    await handleInbound(r.deps, msg('25rb makan siang', { from: ASING_FROM }));
    await handleInbound(r.deps, msg('batal', { from: ASING_FROM }));
    r.clock.advance(HOUR - 1);
    await handleInbound(r.deps, msg('30rb kopi', { from: ASING_FROM }));
    expect(r.sent).toEqual([{ to: ASING_PHONE, text: REPLY.unlinked }]);
    r.clock.advance(1);
    await handleInbound(r.deps, msg('30rb kopi', { from: ASING_FROM }));
    expect(r.sent).toHaveLength(2);

    const after = await h.admin.query<{ n: number }>('select count(*)::int as n from app.entries');
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    const wa = await h.admin.query<{ n: number }>('select count(*)::int as n from app.wa_messages');
    expect(wa.rows[0]?.n).toBe(0);
    // Tanpa data apa pun: tidak ada nominal, nama, atau nama ruang.
    expect(memuatNominal(r.sent, 25_000)).toBe(false);
    expect(REPLY.unlinked).not.toMatch(/Novanda|Farida|Pribadi|Bersama|Rp/);
  });

  it('@lid tanpa senderPhone → diabaikan tanpa balasan; @lid dengan senderPhone → nomor itu', async () => {
    const r = rig();
    await handleInbound(r.deps, msg('25rb makan siang', { from: '123456789012345@lid' }));
    expect(r.sent).toHaveLength(0);
    expect(await entries()).toHaveLength(0);
    expect(r.log).toHaveBeenCalledWith('no_phone');

    await handleInbound(
      r.deps,
      msg('25rb makan siang', { from: '123456789012345@lid', senderPhone: '6281234567890' }),
    );
    expect(await entries()).toHaveLength(1);
    expect(r.sent[0]?.to).toBe(N_PHONE);
  });

  it('bukan pesan pribadi, pesan sendiri, atau bukan teks → diabaikan', async () => {
    const r = rig();
    await handleInbound(r.deps, msg('25rb makan siang', { chatType: 'group' }));
    await handleInbound(r.deps, msg('25rb makan siang', { fromMe: true }));
    await handleInbound(r.deps, msg(null));
    expect(r.sent).toHaveLength(0);
    expect(await entries()).toHaveLength(0);
  });

  it('"hubung KODE" valid dari nomor baru → terhubung, balasan konfirmasi; kiriman ulang diam', async () => {
    const r = rig();
    const code = await createCode(f);
    const m = msg(`hubung ${code.toLowerCase()}`, { from: F_FROM });
    await handleInbound(r.deps, m);
    expect(await resolve(F_PHONE)).toBe(f.id);
    expect(r.sent).toEqual([{ to: F_PHONE, text: REPLY.linked }]);

    await handleInbound(r.deps, m);
    expect(r.sent).toHaveLength(1);
  });

  it('"hubung" kode salah → tidak terhubung, balasan netral', async () => {
    const r = rig();
    await createCode(f);
    await handleInbound(r.deps, msg('hubung ZZZZZZ', { from: F_FROM }));
    expect(await resolve(F_PHONE)).toBeNull();
    expect(r.sent).toEqual([{ to: F_PHONE, text: REPLY.linkFailed }]);
  });

  it('percobaan "hubung" ke-6 dalam satu jam dari nomor sama → ditolak walau kodenya benar', async () => {
    const r = rig();
    for (let i = 0; i < 5; i++) await handleInbound(r.deps, msg('hubung ZZZZZZ', { from: F_FROM }));
    const code = await createCode(f);
    await handleInbound(r.deps, msg(`hubung ${code}`, { from: F_FROM }));
    expect(await resolve(F_PHONE)).toBeNull();
    // Balasan sama dengan kode salah: tidak membocorkan apakah kode ada.
    expect(r.sent.map((s) => s.text)).toEqual(Array(6).fill(REPLY.linkFailed));
    expect(r.log).toHaveBeenCalledWith('link_limited');

    r.clock.advance(HOUR);
    await handleInbound(r.deps, msg(`hubung ${code}`, { from: F_FROM }));
    expect(await resolve(F_PHONE)).toBe(f.id);
  });

  it('percobaan "hubung" ke-31 global dalam satu jam → ditolak walau kodenya benar', async () => {
    const r = rig();
    for (let i = 0; i < 30; i++) {
      const from = `62899000${String(i).padStart(5, '0')}@c.us`;
      await handleInbound(r.deps, msg('hubung ZZZZZZ', { from }));
    }
    const code = await createCode(f);
    await handleInbound(r.deps, msg(`hubung ${code}`, { from: F_FROM }));
    expect(await resolve(F_PHONE)).toBeNull();
    expect(r.sent.at(-1)).toEqual({ to: F_PHONE, text: REPLY.linkFailed });
  });

  it('"beli 2 kopi 50rb" → tidak ada entri, balasan memuat contoh format', async () => {
    const r = rig();
    const m = msg('beli 2 kopi 50rb');
    await handleInbound(r.deps, m);
    expect(await entries()).toHaveLength(0);
    expect(r.sent[0]?.text).toBe('❌ Tidak terbaca. Contoh: 25rb makan siang');
    expect(await messageRow(m.messageId)).toMatchObject({ status: 'rejected' });
  });

  it('nominal di atas maxAmount → ditolak "gunakan app"', async () => {
    const r = rig({ env: { maxAmount: 100_000 } });
    await handleInbound(r.deps, msg('150rb makan'));
    expect(await entries()).toHaveLength(0);
    expect(r.sent[0]?.text).toBe(REPLY.tooLarge);
    expect(REPLY.tooLarge).toMatch(/[Gg]unakan app/);
  });

  it('lewat batas laju per nomor → tidak diproses, tanpa balasan (nomor asing juga)', async () => {
    const r = rig({ env: { ratePerMin: 2 } });
    for (const t of ['1rb a', '2rb b', '3rb c']) await handleInbound(r.deps, msg(t));
    expect((await entries()).map((e) => e.amount)).toEqual([1000, 2000]);
    expect(r.sent).toHaveLength(2);
    expect(r.log).toHaveBeenCalledWith('rate_limited');

    for (let i = 0; i < 3; i++) await handleInbound(r.deps, msg('hubung ZZZZZZ', { from: F_FROM }));
    expect(r.sent.filter((s) => s.to === F_PHONE)).toHaveLength(2);

    r.clock.advance(60_000);
    await handleInbound(r.deps, msg('4rb d'));
    expect(await entries()).toHaveLength(3);
  });

  it('transport.sendText melempar → entri tetap tersimpan, handleInbound tidak melempar', async () => {
    const r = rig();
    r.sendText.mockRejectedValue(new Error('openwa mati'));
    const m = msg('25rb makan siang');
    await expect(handleInbound(r.deps, m)).resolves.toBeUndefined();
    expect(await entries()).toHaveLength(1);
    expect(await messageRow(m.messageId)).toMatchObject({ status: 'recorded' });
    expect(r.log).toHaveBeenCalledWith('reply_failed', 'unknown');
  });

  it('DB tak terjangkau → balasan ⚠️, tidak melempar', async () => {
    const down = {
      app: {
        connect: () => Promise.reject(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })),
      },
      auth: { connect: () => Promise.reject(new Error('x')) },
    } as unknown as Pools;
    const r = rig({ pools: down });
    await expect(handleInbound(r.deps, msg('25rb makan siang'))).resolves.toBeUndefined();
    expect(r.sent).toEqual([{ to: N_PHONE, text: '⚠️ Gagal menyimpan, coba lagi sebentar lagi' }]);
    expect(r.log).toHaveBeenCalledWith('db_error', 'ECONNREFUSED');
  });

  it('createEntry gagal sementara → ⚠️, klaim tetap pending; kirim ulang sesudah 30 detik mencatat sekali', async () => {
    const flaky = failingPools(/api\.create_entry/, 1);
    try {
      const r = rig({ pools: flaky });
      const m = msg('25rb makan siang');
      await handleInbound(r.deps, m);
      expect(await entries()).toHaveLength(0);
      expect(await messageRow(m.messageId)).toMatchObject({ status: 'pending' });
      expect(r.sent).toEqual([{ to: N_PHONE, text: REPLY.failed }]);

      // Kiriman ulang segera: klaim pending masih segar → diam.
      await handleInbound(r.deps, m);
      expect(r.sent).toHaveLength(1);
      expect(await entries()).toHaveLength(0);

      await backdate(m.messageId, '31 seconds');
      await handleInbound(r.deps, m);
      expect(await entries()).toHaveLength(1);
      expect(await messageRow(m.messageId)).toMatchObject({ status: 'recorded' });
      expect(r.sent[1]?.text).toMatch(/^✅ /);
    } finally {
      await flaky.end();
    }
  });

  it('log tidak memuat teks pesan, nominal, atau nomor (spy logger dan console)', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation(() => undefined),
    );
    const r = rig({ env: { ratePerMin: 6 } });
    r.sendText.mockRejectedValueOnce(new Error('openwa mati'));
    await handleInbound(r.deps, msg('25rb makan siang rahasia'));
    await handleInbound(r.deps, msg('beli 2 kopi 50rb'));
    await handleInbound(r.deps, msg('batal'));
    await handleInbound(r.deps, msg('250jt makan rahasia'));
    await handleInbound(r.deps, msg('25rb makan siang', { from: ASING_FROM }));
    await handleInbound(r.deps, msg('hubung ZZZZZZ', { from: F_FROM }));
    for (let i = 0; i < 8; i++) await handleInbound(r.deps, msg('7rb rahasia'));

    expect(r.log).toHaveBeenCalled();
    const logged = [...r.log.mock.calls, ...spies.flatMap((s) => s.mock.calls)];
    const text = JSON.stringify(logged);
    for (const bad of [
      'rahasia',
      'makan',
      'kopi',
      '25rb',
      'ZZZZZZ',
      '81234567890',
      '89900001111',
      '85711112222',
    ]) {
      expect(text).not.toContain(bad);
    }
    for (const amount of [25_000, 50_000, 250_000_000, 7_000]) {
      expect(memuatNominal(logged, amount)).toBe(false);
    }
    for (const call of r.log.mock.calls) {
      expect(call[0]).toMatch(/^[a-z_]+$/);
      if (call[1] !== undefined) expect(call[1]).toMatch(/^[A-Za-z0-9_]{1,32}$/);
    }
  });
});

describe('handleInbound: pilih dompet @nama (Postgres sungguhan)', () => {
  let n: Persona;
  let f: Persona;
  let nPribadi: LedgerCtx;
  let nBersama: LedgerCtx;
  let bca: string;
  let cimb: string;
  let kantor: string;

  beforeEach(async () => {
    await resetLedger(h);
    const personas = await seedPersonas(h, { farida: 'bergabung' });
    n = personas.n;
    f = must(personas.f);
    nPribadi = { pools: h.pools, userId: n.id, spaceId: await spaceIdOf(h, n.id, 'personal') };
    nBersama = { pools: h.pools, userId: n.id, spaceId: await spaceIdOf(h, n.id, 'shared') };
    bca = await wallet(nPribadi, 'operasional', 'BCA');
    cimb = await wallet(nPribadi, 'operasional', 'CIMB Niaga');
    kantor = await wallet(nPribadi, 'kantor', 'Kas Kantor');
    await linkDirect(n, N_PHONE);
  });

  it('"makan siang padang 23rb @cimb" → entri di CIMB (bukan bawaan), @nama keluar dari keterangan, balasan menyebut dompet', async () => {
    const r = rig();
    const m = msg('makan siang padang 23rb @cimb');
    await handleInbound(r.deps, m);
    const rows = await entries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      space_id: nPribadi.spaceId,
      kind: 'expense',
      amount: 23_000,
      account_id: cimb,
      description: 'makan siang padang',
      voided_at: null,
    });
    expect(r.sent).toEqual([
      {
        to: N_PHONE,
        text: `✅ Makan Siang & Minum ${formatRupiah(23_000)} · Pribadi · CIMB Niaga · ketik batal untuk membatalkan`,
      },
    ]);
    expect(await messageRow(m.messageId)).toMatchObject({ status: 'recorded' });
  });

  it('awalan, huruf besar, di awal/tengah/akhir pesan, tanda baca penutup', async () => {
    const r = rig();
    for (const t of ['@CIM 10rb kopi', '10rb @cimb. kopi', 'kopi 10rb @Cimb-Niaga,']) {
      await handleInbound(r.deps, msg(t));
    }
    const rows = await entries();
    expect(rows.map((e) => e.account_id)).toEqual([cimb, cimb, cimb]);
    expect(rows.map((e) => e.description)).toEqual(['kopi', 'kopi', 'kopi']);
  });

  it('nama persis menang atas awalan: @bca → BCA walau ada "BCA Syariah"', async () => {
    const syariah = await wallet(nPribadi, 'operasional', 'BCA Syariah');
    const r = rig();
    await handleInbound(r.deps, msg('10rb kopi @bca'));
    await handleInbound(r.deps, msg('10rb kopi @bca-syariah'));
    expect((await entries()).map((e) => e.account_id)).toEqual([bca, syariah]);
  });

  it('tidak ketemu → tidak ada entri, balasan memuat daftar penanda, status rejected, tidak menebak', async () => {
    const r = rig();
    const m = msg('23rb makan @mandiri');
    await handleInbound(r.deps, m);
    expect(await entries()).toHaveLength(0);
    expect(r.sent).toEqual([
      {
        to: N_PHONE,
        text: REPLY.walletNone('mandiri', 'personal', ['@bca', '@cimb-niaga', '@kas-kantor']),
      },
    ]);
    expect(await messageRow(m.messageId)).toMatchObject({ status: 'rejected' });
    expect(r.log).toHaveBeenCalledWith('rejected', 'wallet_none');
  });

  it('ambigu → ditolak dengan daftar; dompet terarsip tidak ikut dicocokkan', async () => {
    const satu = await wallet(nPribadi, 'operasional', 'Cadangan Satu', 0);
    await wallet(nPribadi, 'operasional', 'Cadangan Dua');
    const r = rig();
    await handleInbound(r.deps, msg('10rb kopi @cad'));
    expect(await entries()).toHaveLength(0);
    expect(r.sent[0]?.text).toContain('cocok dengan lebih dari satu dompet');
    expect(r.sent[0]?.text).toContain('@cadangan-satu, @cadangan-dua');
    expect(r.log).toHaveBeenCalledWith('rejected', 'wallet_ambiguous');

    await archiveAccount(nPribadi, satu);
    await handleInbound(r.deps, msg('10rb kopi @cad'));
    expect((await entries()).map((e) => e.account_id)).toEqual([
      (
        await h.admin.query<{ id: string }>(
          `select id from app.accounts where name = 'Cadangan Dua'`,
        )
      ).rows[0]?.id,
    ]);
    // dompet terarsip tidak tampil di daftar balasan
    await handleInbound(r.deps, msg('10rb kopi @cadangan-satu'));
    expect(r.sent.at(-1)?.text).not.toContain('@cadangan-satu,');
    expect(r.sent.at(-1)?.text).toMatch(/^❌ Dompet @cadangan-satu tidak ada/);
  });

  it('Bersama: "b ... @nama" hanya mencocokkan dompet Bersama; dompet Pribadi tidak terlihat', async () => {
    const kas = await wallet(nBersama, 'operasional', 'Dapur Rumah');
    const r = rig();
    await handleInbound(r.deps, msg('b 80rb belanja @dapur'));
    expect((await entries())[0]).toMatchObject({
      space_id: nBersama.spaceId,
      account_id: kas,
      amount: 80_000,
    });
    expect(r.sent[0]?.text).toBe(
      `✅ ${(await entries())[0]?.category_name ?? '?'} ${formatRupiah(80_000)} · Bersama · Dapur Rumah · ketik batal untuk membatalkan`,
    );

    // @cimb ada di Pribadi, bukan di Bersama
    await handleInbound(r.deps, msg('b 10rb belanja @cimb'));
    expect(await entries()).toHaveLength(1);
    expect(r.sent[1]?.text).toBe(REPLY.walletNone('cimb', 'shared', ['@dapur-rumah']));
    // dan sebaliknya: @dapur (Bersama) tidak ada di Pribadi
    await handleInbound(r.deps, msg('10rb belanja @dapur'));
    expect(await entries()).toHaveLength(1);
    expect(r.sent[2]?.text).toMatch(/^❌ Dompet @dapur tidak ada di ruang Pribadi/);
  });

  it('@kantor eksplisit boleh mencatat ke dompet kantor; bawaan tetap tidak pernah kantor', async () => {
    const r = rig();
    await handleInbound(r.deps, msg('50rb makan siang @kantor'));
    await handleInbound(r.deps, msg('51rb bensin @kas-kantor'));
    expect((await entries()).map((e) => e.account_id)).toEqual([kantor, kantor]);
    expect(r.sent[0]?.text).toContain('· Pribadi · Kas Kantor · ketik batal');

    // tanpa penanda: dompet bawaan = catatan terakhir yang BUKAN kantor, bukan Kas Kantor
    await handleInbound(r.deps, msg('10rb kopi'));
    const last = (await entries()).at(-1);
    expect(last?.account_id).not.toBe(kantor);
    expect(last?.account_id).toBe(bca);
  });

  it('"b ... @kantor" ditolak: kantong kantor hanya ada di Pribadi', async () => {
    await wallet(nBersama, 'operasional', 'Dapur Rumah');
    const r = rig();
    await handleInbound(r.deps, msg('b 50rb makan @kantor'));
    expect(await entries()).toHaveLength(0);
    expect(r.sent[0]?.text).toBe(REPLY.walletNone('kantor', 'shared', ['@dapur-rumah']));
  });

  it('dompet bawaan mengikuti catatan terakhir, termasuk yang dipilih lewat @nama', async () => {
    const r = rig();
    await handleInbound(r.deps, msg('10rb kopi @cimb'));
    await handleInbound(r.deps, msg('10rb kopi'));
    expect((await entries()).map((e) => e.account_id)).toEqual([cimb, cimb]);
  });

  it('saldo kurang di dompet pilihan → ditolak, balasan menyebut dompet itu', async () => {
    const r = rig();
    const m = msg('2jt makan @bca');
    await handleInbound(r.deps, m);
    expect(await entries()).toHaveLength(0);
    expect(r.sent[0]?.text).toBe(REPLY.insufficient('BCA'));
    expect(await messageRow(m.messageId)).toMatchObject({ status: 'rejected' });
  });

  it('dompet bawaan kurang saldo: tanpa penanda ditolak, dengan @nama dompet lain lolos', async () => {
    const kecil = await wallet(nPribadi, 'operasional', 'Kecil', 10_000);
    const r = rig();
    await handleInbound(r.deps, msg('1rb jajan @kecil')); // bawaan sekarang = Kecil (saldo 9.000)
    await handleInbound(r.deps, msg('50rb makan')); // bawaan Kecil: saldo kurang
    expect(r.sent[1]?.text).toBe(REPLY.insufficient('Kecil'));
    await handleInbound(r.deps, msg('50rb makan @bca'));
    expect((await entries()).map((e) => e.account_id)).toEqual([kecil, bca]);
  });

  it('dompet milik user lain tidak terlihat (RLS): @nama Farida tidak ketemu dan tidak bocor di daftar', async () => {
    const fPribadi = {
      pools: h.pools,
      userId: f.id,
      spaceId: await spaceIdOf(h, f.id, 'personal'),
    };
    await wallet(fPribadi, 'operasional', 'Rahasia Farida');
    const r = rig();
    await handleInbound(r.deps, msg('10rb kopi @rahasia'));
    expect(await entries()).toHaveLength(0);
    expect(r.sent[0]?.text).not.toMatch(/farida/i);
    expect(r.sent[0]?.text).toMatch(/^❌ Dompet @rahasia tidak ada di ruang Pribadi/);
  });

  it('dua penanda / penanda rusak → ditolak sebelum menyentuh dompet; tanpa entri', async () => {
    const r = rig();
    await handleInbound(r.deps, msg('10rb kopi @bca @cimb'));
    await handleInbound(r.deps, msg('10rb kopi @bca,x'));
    expect(await entries()).toHaveLength(0);
    expect(r.sent.map((x) => x.text)).toEqual([REPLY.manyWallets, REPLY.badWallet]);
  });

  it('@ yang bukan penanda tetap keterangan dan memakai dompet bawaan', async () => {
    const r = rig();
    await handleInbound(r.deps, msg('25rb kirim ke budi@gmail.com'));
    const [e] = await entries();
    expect(e).toMatchObject({ description: 'kirim ke budi@gmail.com', amount: 25_000 });
    expect(e?.account_id).toBe(bca);
  });

  it('pesan yang sama dua kali dengan @nama → satu entri (idempoten)', async () => {
    const r = rig();
    const m = msg('23rb makan @cimb');
    await handleInbound(r.deps, m);
    await handleInbound(r.deps, m);
    expect(await entries()).toHaveLength(1);
    expect(r.sent).toHaveLength(1);
  });

  it('batal sesudah entri @nama → entri dibatalkan; balasan dan log tidak memuat nama dompet', async () => {
    const r = rig();
    await handleInbound(r.deps, msg('23rb makan @cimb'));
    await handleInbound(r.deps, msg('batal'));
    expect((await entries())[0]?.voided_at).not.toBeNull();
    const logged = JSON.stringify(r.log.mock.calls);
    for (const bad of ['cimb', 'niaga', 'CIMB', 'bca']) expect(logged).not.toContain(bad);
    await handleInbound(r.deps, msg('23rb makan @mandiri'));
    expect(JSON.stringify(r.log.mock.calls)).not.toContain('mandiri');
  });
});
