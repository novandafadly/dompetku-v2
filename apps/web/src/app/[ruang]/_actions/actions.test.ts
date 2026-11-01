import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redirect } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@/server/auth/service';
import type { ProductEventInput } from '@/server/ledger/events';
import { SpaceNotFoundError } from '@/server/ledger/space';
import type { CatatEventInput } from './inputs';

/**
 * Server Action ruang = endpoint publik (TRD §3.4, Aturan M1): gerbang `requireDataUser()` →
 * Zod → `withUser`. Semua dependensi server di-mock: tes ini memeriksa urutan dan pemetaan galat,
 * bukan SQL (lihat `__int__/actions.int.test.ts`).
 */

const POOLS = { auth: {}, app: {} };
const USER_ID = '11111111-1111-4111-8111-111111111111';
const SPACE_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_SPACE = '33333333-3333-4333-8333-333333333333';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const m = vi.hoisted(() => ({
  requireDataUser: vi.fn(),
  resolveSpace: vi.fn(),
  refresh: vi.fn(),
  revalidatePath: vi.fn(),
  createEntry: vi.fn(),
  createTransfer: vi.fn(),
  updateEntry: vi.fn(),
  voidEntry: vi.fn(),
  restoreEntry: vi.fn(),
  createAccount: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  archiveCategory: vi.fn(),
  markNoSpendDay: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  suggestCategories: vi.fn(),
  getEntry: vi.fn(),
  recordProductEvent: vi.fn(),
}));

vi.mock('@/server/auth/next', () => ({
  requireDataUser: m.requireDataUser,
  authService: () => ({ pools: POOLS }),
}));
vi.mock('next/cache', () => ({ refresh: m.refresh, revalidatePath: m.revalidatePath }));
vi.mock('@/server/ledger/space', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/space')>()),
  resolveSpace: m.resolveSpace,
}));
vi.mock('@/server/ledger/write', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/write')>()),
  createEntry: m.createEntry,
  createTransfer: m.createTransfer,
  updateEntry: m.updateEntry,
  voidEntry: m.voidEntry,
  restoreEntry: m.restoreEntry,
  createAccount: m.createAccount,
  createCategory: m.createCategory,
  updateCategory: m.updateCategory,
  archiveCategory: m.archiveCategory,
  markNoSpendDay: m.markNoSpendDay,
}));
vi.mock('@/server/ledger/read', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/read')>()),
  listAccounts: m.listAccounts,
  listCategories: m.listCategories,
  suggestCategories: m.suggestCategories,
  getEntry: m.getEntry,
}));
vi.mock('@/server/ledger/events', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/events')>()),
  recordProductEvent: m.recordProductEvent,
}));

const catat = await import('./catat');
const entri = await import('./entri');
const kategori = await import('./kategori');
const dompet = await import('./dompet');
const beranda = await import('./beranda');

type AnyAction = (ruang: unknown, input?: unknown) => Promise<unknown>;

const ACTIONS: Record<string, AnyAction> = {
  ...(catat as unknown as Record<string, AnyAction>),
  ...(entri as unknown as Record<string, AnyAction>),
  ...(kategori as unknown as Record<string, AnyAction>),
  ...(dompet as unknown as Record<string, AnyAction>),
  ...(beranda as unknown as Record<string, AnyAction>),
};

/** Input sah per action dan wrapper DB pertama yang dipanggilnya. */
const CASES: Record<string, { input?: unknown; wrapper: keyof typeof m; mutation: boolean }> = {
  saveCatat: {
    input: { kind: 'expense', clientId: A, accountId: B, amount: 35_000, categoryId: C },
    wrapper: 'createEntry',
    mutation: true,
  },
  catatOptions: { wrapper: 'listAccounts', mutation: false },
  suggestFor: {
    input: { type: 'expense', hour: 9 },
    wrapper: 'suggestCategories',
    mutation: false,
  },
  logCatatEvent: {
    input: { event: 'catat_dibuka', flowId: A },
    wrapper: 'recordProductEvent',
    mutation: false,
  },
  updateEntryAction: {
    input: {
      clientId: A,
      entryId: B,
      expectedVersion: 1,
      accountId: C,
      amount: 1_000,
      categoryId: D,
      occurredOn: null,
      description: null,
      reimbursable: false,
    },
    wrapper: 'updateEntry',
    mutation: true,
  },
  voidEntryAction: {
    input: { clientId: A, entryId: B, expectedVersion: 1 },
    wrapper: 'voidEntry',
    mutation: true,
  },
  restoreEntryAction: {
    input: { clientId: A, entryId: B, expectedVersion: 2 },
    wrapper: 'restoreEntry',
    mutation: true,
  },
  reloadEntry: { input: B, wrapper: 'getEntry', mutation: false },
  createCategoryAction: {
    input: { clientId: A, type: 'expense', name: 'Kopi', icon: 'Coffee' },
    wrapper: 'createCategory',
    mutation: true,
  },
  updateCategoryAction: {
    input: { categoryId: A, name: 'Kopi', icon: 'Coffee', parentId: null },
    wrapper: 'updateCategory',
    mutation: true,
  },
  archiveCategoryAction: { input: { categoryId: A }, wrapper: 'archiveCategory', mutation: true },
  createAccountAction: {
    input: {
      clientId: A,
      name: 'Dompet',
      pocket: 'operasional',
      walletType: 'cash',
      openingBalance: 0,
    },
    wrapper: 'createAccount',
    mutation: true,
  },
  markNoSpendDayAction: { wrapper: 'markNoSpendDay', mutation: true },
};

const NAMES = Object.keys(CASES);
const WRAPPERS = [
  'createEntry',
  'createTransfer',
  'updateEntry',
  'voidEntry',
  'restoreEntry',
  'createAccount',
  'createCategory',
  'updateCategory',
  'archiveCategory',
  'markNoSpendDay',
  'listAccounts',
  'listCategories',
  'suggestCategories',
  'getEntry',
  'recordProductEvent',
] as const;

function call(name: string, ruang: unknown = 'pribadi', input?: unknown): Promise<unknown> {
  const action = ACTIONS[name];
  const c = CASES[name];
  if (!action || !c) throw new Error(`action ${name} tidak dikenal`);
  return action(ruang, input ?? c.input);
}

function session(): SessionState {
  return { userId: USER_ID } as SessionState;
}

beforeEach(() => {
  m.requireDataUser.mockResolvedValue(session());
  m.resolveSpace.mockResolvedValue({ spaceId: SPACE_ID, kind: 'personal' });
  m.createEntry.mockResolvedValue({ entryId: D, version: 1, replayed: false, warnings: [] });
  m.createTransfer.mockResolvedValue({ entryId: D, version: 1, replayed: false });
  m.updateEntry.mockResolvedValue({ entryId: B, version: 2 });
  m.voidEntry.mockResolvedValue({ version: 2 });
  m.restoreEntry.mockResolvedValue({ version: 3 });
  m.createAccount.mockResolvedValue({ accountId: A });
  m.createCategory.mockResolvedValue({ categoryId: A });
  m.updateCategory.mockResolvedValue(undefined);
  m.archiveCategory.mockResolvedValue({ affected: 1 });
  m.markNoSpendDay.mockResolvedValue(undefined);
  m.listAccounts.mockResolvedValue([]);
  m.listCategories.mockResolvedValue([]);
  m.suggestCategories.mockResolvedValue([A, B]);
  m.getEntry.mockResolvedValue({ entry: { id: B, version: 2 }, history: [] });
  m.recordProductEvent.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('daftar action', () => {
  it('setiap action exported punya kasus uji (action baru wajib ditambah ke CASES)', () => {
    expect(Object.keys(ACTIONS).sort()).toEqual([...NAMES].sort());
  });
});

describe('gerbang (Review Focus 5)', () => {
  it.each(NAMES)('action menolak di mode prototipe: %s', async (name) => {
    m.requireDataUser.mockResolvedValue(null);
    await expect(call(name)).rejects.toThrow('prototipe');
    expect(m.resolveSpace).not.toHaveBeenCalled();
    for (const w of WRAPPERS) expect(m[w]).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it.each(NAMES)('setiap action memanggil requireDataUser sebelum wrapper: %s', async (name) => {
    const c = CASES[name];
    if (!c) throw new Error(name);
    await call(name);
    const gate = m.requireDataUser.mock.invocationCallOrder[0];
    const resolve = m.resolveSpace.mock.invocationCallOrder[0];
    const wrapper = m[c.wrapper].mock.invocationCallOrder[0];
    expect(gate).toBeDefined();
    expect(resolve).toBeDefined();
    expect(wrapper).toBeDefined();
    expect(gate).toBeLessThan(resolve ?? 0);
    expect(resolve).toBeLessThan(wrapper ?? 0);
    expect(m.resolveSpace).toHaveBeenCalledWith(POOLS, USER_ID, 'pribadi');
  });

  it.each(NAMES)('redirect sesi (belum masuk) diteruskan, tidak jadi hasil: %s', async (name) => {
    m.requireDataUser.mockImplementation(() => redirect('/masuk'));
    await expect(call(name)).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT') as unknown,
    });
    for (const w of WRAPPERS) expect(m[w]).not.toHaveBeenCalled();
  });

  it('pemindaian sumber: setiap export async function memanggil actionContext( di baris pertama', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'context.ts',
    );
    const seen: string[] = [];
    for (const file of files) {
      const src = readFileSync(path.join(dir, file), 'utf8');
      const fns = exportedAsyncFunctions(src);
      if (fns.length === 0) continue;
      expect(src.startsWith("'use server';"), `${file} tanpa 'use server'`).toBe(true);
      for (const { name, firstLine } of fns) {
        seen.push(name);
        // Baris pertama badan: `return <wrapper>('<nama>', actionContext(ruang), …`.
        // Argumen dievaluasi kiri ke kanan, jadi actionContext (requireDataUser) dipanggil sebelum
        // apa pun; wrapper hanya meng-await hasilnya di dalam try untuk memetakan galat.
        expect(firstLine, `${file}:${name}`).toMatch(
          new RegExp(`^return \\w+\\('${name}', actionContext\\(ruang\\)`),
        );
      }
    }
    expect(seen.sort()).toEqual([...NAMES].sort());
  });
});

/**
 * Nama dan baris pertama badan setiap `export async function`: lewati daftar parameter (kurung
 * seimbang) dan tipe kembali (kurung sudut seimbang), lalu `{` pertama = awal badan.
 */
function exportedAsyncFunctions(src: string): { name: string; firstLine: string }[] {
  const out: { name: string; firstLine: string }[] = [];
  for (const match of src.matchAll(/export\s+async\s+function\s+(\w+)\s*\(/g)) {
    let i = match.index + match[0].length;
    for (let depth = 1; depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    for (let angle = 0; ; i++) {
      const ch = src[i];
      if (ch === '<') angle++;
      else if (ch === '>') angle--;
      else if (ch === '{' && angle === 0) break;
    }
    const firstLine =
      src
        .slice(i + 1)
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l !== '') ?? '';
    out.push({ name: match[1] ?? '', firstLine });
  }
  return out;
}

describe('ruang', () => {
  it.each(NAMES.filter((n) => n !== 'logCatatEvent'))(
    'ruang tidak sah (kantor) = invalid ruang: %s',
    async (name) => {
      await expect(call(name, 'kantor')).resolves.toEqual({
        ok: false,
        error: { code: 'invalid', field: 'ruang' },
      });
      expect(m.resolveSpace).not.toHaveBeenCalled();
      for (const w of WRAPPERS) expect(m[w]).not.toHaveBeenCalled();
    },
  );

  it('logCatatEvent dengan ruang tidak sah: diam, tanpa DB', async () => {
    await expect(call('logCatatEvent', 'kantor')).resolves.toBeUndefined();
    expect(m.resolveSpace).not.toHaveBeenCalled();
    expect(m.recordProductEvent).not.toHaveBeenCalled();
  });

  it('ruang bukan anggota (SpaceNotFoundError) = not_found', async () => {
    m.resolveSpace.mockRejectedValue(new SpaceNotFoundError());
    await expect(call('saveCatat', 'bersama')).resolves.toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(m.createEntry).not.toHaveBeenCalled();
  });

  it('spaceId dari klien diabaikan; ctx dari resolveSpace', async () => {
    await call('saveCatat', 'pribadi', {
      kind: 'expense',
      clientId: A,
      accountId: B,
      amount: 35_000,
      categoryId: C,
      spaceId: OTHER_SPACE,
    });
    expect(m.createEntry).toHaveBeenCalledTimes(1);
    const [ctx, input] = m.createEntry.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(ctx).toEqual({ pools: POOLS, userId: USER_ID, spaceId: SPACE_ID });
    expect(input).not.toHaveProperty('spaceId');
  });
});

describe('pemetaan galat', () => {
  it('ZodError input = invalid + field jalur isu pertama, wrapper tidak dipanggil', async () => {
    await expect(
      call('saveCatat', 'pribadi', {
        kind: 'expense',
        clientId: A,
        accountId: B,
        amount: -5,
        categoryId: C,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'amount' } });
    expect(m.createEntry).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('ZodError bersarang = jalur digabung titik', async () => {
    await expect(
      call('saveCatat', 'pribadi', {
        kind: 'transfer',
        clientId: A,
        fromAccountId: B,
        toAccountId: B,
        amount: 1_000,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'toAccountId' } });
    expect(m.createTransfer).not.toHaveBeenCalled();
  });

  it('kind tidak dikenal = invalid kind', async () => {
    await expect(
      call('saveCatat', 'pribadi', { kind: 'space_transfer', clientId: A, amount: 1 }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'kind' } });
  });

  it('reloadEntry id bukan uuid = invalid entryId', async () => {
    await expect(call('reloadEntry', 'pribadi', 'bukan-uuid')).resolves.toEqual({
      ok: false,
      error: { code: 'invalid', field: 'entryId' },
    });
    expect(m.getEntry).not.toHaveBeenCalled();
  });

  it('galat domain dipetakan toLedgerError (DK409 = conflict)', async () => {
    m.updateEntry.mockRejectedValue(
      Object.assign(new Error('version_conflict'), { code: 'DK409' }),
    );
    await expect(call('updateEntryAction')).resolves.toEqual({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('galat tak dikenal: log hanya nama action + kode pg, hasil unknown', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.createEntry.mockRejectedValue(
      Object.assign(new Error('Rp 35.000 kopi rahasia'), {
        code: '23503',
        detail: 'Key (account_id)=(rahasia) is not present',
      }),
    );
    await expect(call('saveCatat')).resolves.toEqual({ ok: false, error: { code: 'unknown' } });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[ledger action]', 'saveCatat', '23503');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/rahasia|35\.000|kopi/);
  });

  it('galat tak dikenal tanpa kode: log nama galat saja', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.listAccounts.mockRejectedValue(new TypeError('cannot read amount 35000'));
    await expect(call('catatOptions')).resolves.toEqual({ ok: false, error: { code: 'unknown' } });
    expect(log).toHaveBeenCalledWith('[ledger action]', 'catatOptions', 'TypeError');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/35000|amount/);
  });

  it('kode/nama galat aneh tidak ikut dilog mentah', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.createAccount.mockRejectedValue({ code: 'nominal 9000 bocor', name: 'x y' });
    await expect(call('createAccountAction')).resolves.toEqual({
      ok: false,
      error: { code: 'unknown' },
    });
    expect(log).toHaveBeenCalledWith('[ledger action]', 'createAccountAction', 'unknown');
  });
});

describe('refresh sesudah mutasi', () => {
  it.each(NAMES)('%s', async (name) => {
    const c = CASES[name];
    if (!c) throw new Error(name);
    await call(name);
    expect(m.refresh).toHaveBeenCalledTimes(c.mutation ? 1 : 0);
  });

  it('mutasi gagal tidak me-refresh', async () => {
    m.voidEntry.mockRejectedValue(Object.assign(new Error('not_found'), { code: 'DK404' }));
    await call('voidEntryAction');
    expect(m.refresh).not.toHaveBeenCalled();
  });
});

describe('catat', () => {
  it('saveCatat expense ke createEntry; hasil tanpa warnings', async () => {
    m.createEntry.mockResolvedValue({ entryId: D, version: 1, replayed: true, warnings: ['x'] });
    await expect(call('saveCatat')).resolves.toEqual({
      ok: true,
      value: { entryId: D, version: 1, replayed: true },
    });
    expect(m.createEntry).toHaveBeenCalledWith(
      { pools: POOLS, userId: USER_ID, spaceId: SPACE_ID },
      { kind: 'expense', clientId: A, accountId: B, amount: 35_000, categoryId: C },
    );
    expect(m.createTransfer).not.toHaveBeenCalled();
  });

  it('saveCatat income ke createEntry', async () => {
    await call('saveCatat', 'bersama', {
      kind: 'income',
      clientId: A,
      accountId: B,
      amount: 5_000_000,
      categoryId: C,
      occurredOn: '2026-10-31',
      description: 'Gaji',
    });
    expect(m.createEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'income', occurredOn: '2026-10-31', description: 'Gaji' }),
    );
  });

  it('saveCatat transfer ke createTransfer di ruang yang sama', async () => {
    await expect(
      call('saveCatat', 'pribadi', {
        kind: 'transfer',
        clientId: A,
        fromAccountId: B,
        toAccountId: C,
        amount: 100_000,
        allowNegative: true,
      }),
    ).resolves.toEqual({ ok: true, value: { entryId: D, version: 1, replayed: false } });
    expect(m.createTransfer).toHaveBeenCalledWith(
      { pools: POOLS, userId: USER_ID, spaceId: SPACE_ID },
      expect.objectContaining({ fromAccountId: B, toAccountId: C, amount: 100_000 }),
    );
    expect(m.createEntry).not.toHaveBeenCalled();
  });

  it('catatOptions: dompet dan kategori aktif ruang ini', async () => {
    m.listAccounts.mockResolvedValue([{ id: A }]);
    m.listCategories.mockResolvedValue([{ id: B }]);
    await expect(call('catatOptions', 'bersama')).resolves.toEqual({
      ok: true,
      value: { accounts: [{ id: A }], categories: [{ id: B }] },
    });
    expect(m.listCategories).toHaveBeenCalledWith({
      pools: POOLS,
      userId: USER_ID,
      spaceId: SPACE_ID,
    });
  });

  it('suggestFor meneruskan jenis, jam, nominal, deskripsi', async () => {
    await expect(
      call('suggestFor', 'pribadi', { type: 'income', hour: 23, amount: 1, description: 'x' }),
    ).resolves.toEqual({ ok: true, value: [A, B] });
    expect(m.suggestCategories).toHaveBeenCalledWith(expect.anything(), {
      type: 'income',
      hour: 23,
      amount: 1,
      description: 'x',
    });
  });

  it('suggestFor jam di luar 0..23 = invalid hour', async () => {
    await expect(call('suggestFor', 'pribadi', { type: 'expense', hour: 24 })).resolves.toEqual({
      ok: false,
      error: { code: 'invalid', field: 'hour' },
    });
  });

  it('logCatatEvent: spaceKind dari ruang server', async () => {
    m.resolveSpace.mockResolvedValue({ spaceId: SPACE_ID, kind: 'shared' });
    await expect(
      call('logCatatEvent', 'bersama', {
        event: 'catat_disimpan',
        flowId: A,
        taps: 3,
        durationMs: 4_200,
      }),
    ).resolves.toBeUndefined();
    expect(m.recordProductEvent).toHaveBeenCalledWith(POOLS, USER_ID, {
      event: 'catat_disimpan',
      spaceKind: 'shared',
      flowId: A,
      taps: 3,
      durationMs: 4_200,
    });
  });

  it('logCatatEvent menelan galat DB dan galat input', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.recordProductEvent.mockRejectedValue(new Error('boom'));
    await expect(call('logCatatEvent')).resolves.toBeUndefined();
    await expect(
      call('logCatatEvent', 'pribadi', { event: 'catat_disimpan', flowId: A }),
    ).resolves.toBeUndefined();
    await expect(
      call('logCatatEvent', 'pribadi', { event: 'tanpa_pengeluaran', flowId: A }),
    ).resolves.toBeUndefined();
    expect(m.recordProductEvent).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/boom/);
  });
});

describe('tipe event (temuan terbawa Task 9)', () => {
  it('catat_disimpan tanpa taps/durationMs = galat kompilasi', () => {
    // @ts-expect-error taps dan durationMs wajib untuk catat_disimpan
    const server: ProductEventInput = { event: 'catat_disimpan', spaceKind: 'personal', flowId: A };
    // @ts-expect-error taps dan durationMs wajib untuk catat_batal
    const client: CatatEventInput = { event: 'catat_batal', flowId: A };
    const dibuka: CatatEventInput = { event: 'catat_dibuka', flowId: A };
    expect([server.event, client.event, dibuka.event]).toEqual([
      'catat_disimpan',
      'catat_batal',
      'catat_dibuka',
    ]);
  });
});

describe('entri', () => {
  it('updateEntryAction ganti-penuh', async () => {
    await expect(call('updateEntryAction')).resolves.toEqual({
      ok: true,
      value: { entryId: B, version: 2 },
    });
  });

  it('voidEntryAction dan restoreEntryAction mengembalikan versi', async () => {
    await expect(call('voidEntryAction')).resolves.toEqual({ ok: true, value: { version: 2 } });
    await expect(call('restoreEntryAction')).resolves.toEqual({ ok: true, value: { version: 3 } });
  });

  it('restoreEntryAction lewat 90 hari = restore_window_closed', async () => {
    m.restoreEntry.mockRejectedValue(
      Object.assign(new Error('restore_window_closed'), { code: 'DK422' }),
    );
    await expect(call('restoreEntryAction')).resolves.toEqual({
      ok: false,
      error: { code: 'restore_window_closed' },
    });
  });

  it('reloadEntry: entri terbaru + riwayat; tidak ada = not_found', async () => {
    await expect(call('reloadEntry')).resolves.toEqual({
      ok: true,
      value: { entry: { id: B, version: 2 }, history: [] },
    });
    m.getEntry.mockResolvedValue(null);
    await expect(call('reloadEntry')).resolves.toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
  });
});

describe('kategori dan dompet', () => {
  it('createCategoryAction, updateCategoryAction, archiveCategoryAction', async () => {
    await expect(call('createCategoryAction')).resolves.toEqual({
      ok: true,
      value: { categoryId: A },
    });
    await expect(call('updateCategoryAction')).resolves.toEqual({ ok: true, value: undefined });
    await expect(call('archiveCategoryAction')).resolves.toEqual({
      ok: true,
      value: { affected: 1 },
    });
  });

  it('createAccountAction', async () => {
    await expect(call('createAccountAction')).resolves.toEqual({
      ok: true,
      value: { accountId: A },
    });
  });
});

describe('beranda', () => {
  it('markNoSpendDayAction mencatat event tanpa_pengeluaran sesudah tanda', async () => {
    m.resolveSpace.mockResolvedValue({ spaceId: SPACE_ID, kind: 'shared' });
    await expect(call('markNoSpendDayAction', 'bersama')).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(m.recordProductEvent).toHaveBeenCalledWith(POOLS, USER_ID, {
      event: 'tanpa_pengeluaran',
      spaceKind: 'shared',
    });
    const mark = m.markNoSpendDay.mock.invocationCallOrder[0] ?? 0;
    const event = m.recordProductEvent.mock.invocationCallOrder[0] ?? 0;
    expect(mark).toBeLessThan(event);
  });

  it('event gagal ditelan; hasil tanda tetap ok', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.recordProductEvent.mockRejectedValue(new Error('boom'));
    await expect(call('markNoSpendDayAction')).resolves.toEqual({ ok: true, value: undefined });
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it('tanda gagal: tanpa event', async () => {
    m.markNoSpendDay.mockRejectedValue(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
    await expect(call('markNoSpendDayAction')).resolves.toEqual({
      ok: false,
      error: { code: 'network' },
    });
    expect(m.recordProductEvent).not.toHaveBeenCalled();
  });
});
