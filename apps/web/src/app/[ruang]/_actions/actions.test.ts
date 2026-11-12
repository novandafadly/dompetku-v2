import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  createSpaceTransfer: vi.fn(),
  moveEntryToSpace: vi.fn(),
  reconcileBalance: vi.fn(),
  archiveAccount: vi.fn(),
  loadRuangShell: vi.fn(),
  createReimbursement: vi.fn(),
  openReimbursables: vi.fn(),
  setBudget: vi.fn(),
  deleteBudget: vi.fn(),
  copyBudgets: vi.fn(),
  createBill: vi.fn(),
  updateBill: vi.fn(),
  archiveBill: vi.fn(),
  payBill: vi.fn(),
  setOccurrenceSkipped: vi.fn(),
  createContact: vi.fn(),
  renameContact: vi.fn(),
  archiveContact: vi.fn(),
  createDebt: vi.fn(),
  updateDebtInfo: vi.fn(),
  payDebt: vi.fn(),
  voidDebt: vi.fn(),
  restoreDebt: vi.fn(),
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
  createSpaceTransfer: m.createSpaceTransfer,
  moveEntryToSpace: m.moveEntryToSpace,
  reconcileBalance: m.reconcileBalance,
  archiveAccount: m.archiveAccount,
}));
vi.mock('@/server/ledger/reimburse', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/reimburse')>()),
  createReimbursement: m.createReimbursement,
  openReimbursables: m.openReimbursables,
}));
vi.mock('@/server/ledger/rencana', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/rencana')>()),
  setBudget: m.setBudget,
  deleteBudget: m.deleteBudget,
  copyBudgets: m.copyBudgets,
  createBill: m.createBill,
  updateBill: m.updateBill,
  archiveBill: m.archiveBill,
  payBill: m.payBill,
  setOccurrenceSkipped: m.setOccurrenceSkipped,
}));
vi.mock('@/server/ledger/utang', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/utang')>()),
  createContact: m.createContact,
  renameContact: m.renameContact,
  archiveContact: m.archiveContact,
  createDebt: m.createDebt,
  updateDebtInfo: m.updateDebtInfo,
  payDebt: m.payDebt,
  voidDebt: m.voidDebt,
  restoreDebt: m.restoreDebt,
}));
vi.mock('@/server/ledger/read', async (orig) => ({
  ...(await orig<typeof import('@/server/ledger/read')>()),
  listAccounts: m.listAccounts,
  listCategories: m.listCategories,
  suggestCategories: m.suggestCategories,
  getEntry: m.getEntry,
  loadRuangShell: m.loadRuangShell,
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
const reimburse = await import('./reimburse');
const rencana = await import('./rencana');
const utang = await import('./utang');

type AnyAction = (ruang: unknown, input?: unknown) => Promise<unknown>;

const ACTIONS: Record<string, AnyAction> = {
  ...(catat as unknown as Record<string, AnyAction>),
  ...(entri as unknown as Record<string, AnyAction>),
  ...(kategori as unknown as Record<string, AnyAction>),
  ...(dompet as unknown as Record<string, AnyAction>),
  ...(beranda as unknown as Record<string, AnyAction>),
  ...(reimburse as unknown as Record<string, AnyAction>),
  ...(rencana as unknown as Record<string, AnyAction>),
  ...(utang as unknown as Record<string, AnyAction>),
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
  moveEntryAction: {
    input: {
      clientId: A,
      entryId: B,
      expectedVersion: 1,
      toRuang: 'bersama',
      accountId: C,
      categoryId: D,
    },
    wrapper: 'moveEntryToSpace',
    mutation: true,
  },
  moveTargetsAction: { input: 'bersama', wrapper: 'loadRuangShell', mutation: false },
  reconcileAction: {
    input: { clientId: A, accountId: B, actualBalance: 125_000 },
    wrapper: 'reconcileBalance',
    mutation: true,
  },
  archiveAccountAction: { input: B, wrapper: 'archiveAccount', mutation: true },
  createReimbursementAction: {
    input: { clientId: A, entryId: B, accountId: C, amount: 300_000 },
    wrapper: 'createReimbursement',
    mutation: true,
  },
  openReimbursablesAction: { wrapper: 'openReimbursables', mutation: false },
  setBudgetAction: {
    input: { categoryId: A, month: '2026-11', amount: 2_000_000, wajib: false },
    wrapper: 'setBudget',
    mutation: true,
  },
  deleteBudgetAction: {
    input: { categoryId: A, month: '2026-11' },
    wrapper: 'deleteBudget',
    mutation: true,
  },
  copyBudgetsAction: { input: { toMonth: '2026-11' }, wrapper: 'copyBudgets', mutation: true },
  createBillAction: {
    input: {
      clientId: A,
      name: 'Listrik PLN',
      amount: 485_000,
      categoryId: B,
      dayOfMonth: 20,
      startsOn: '2026-11-01',
    },
    wrapper: 'createBill',
    mutation: true,
  },
  updateBillAction: {
    input: {
      billId: A,
      name: 'Listrik PLN',
      amount: 500_000,
      categoryId: B,
      dayOfMonth: 21,
      endsOn: null,
      accountId: null,
    },
    wrapper: 'updateBill',
    mutation: true,
  },
  archiveBillAction: { input: A, wrapper: 'archiveBill', mutation: true },
  payBillAction: {
    input: { clientId: A, occurrenceId: B, accountId: C },
    wrapper: 'payBill',
    mutation: true,
  },
  skipBillAction: { input: B, wrapper: 'setOccurrenceSkipped', mutation: true },
  unskipBillAction: { input: B, wrapper: 'setOccurrenceSkipped', mutation: true },
  createContactAction: {
    input: { clientId: A, name: 'Budi' },
    wrapper: 'createContact',
    mutation: true,
  },
  renameContactAction: {
    input: { contactId: A, name: 'Budi S' },
    wrapper: 'renameContact',
    mutation: true,
  },
  archiveContactAction: { input: { contactId: A }, wrapper: 'archiveContact', mutation: true },
  createDebtAction: {
    input: {
      clientId: A,
      direction: 'borrowed',
      principal: 2_000_000,
      mode: 'baru',
      contactName: 'Budi',
      accountId: B,
    },
    wrapper: 'createDebt',
    mutation: true,
  },
  updateDebtInfoAction: {
    input: { debtId: A, contactId: B, title: null, note: null },
    wrapper: 'updateDebtInfo',
    mutation: true,
  },
  payDebtAction: {
    input: { clientId: A, debtId: B, accountId: C, amount: 500_000 },
    wrapper: 'payDebt',
    mutation: true,
  },
  voidDebtAction: { input: { clientId: A, debtId: B }, wrapper: 'voidDebt', mutation: true },
  restoreDebtAction: { input: { clientId: A, debtId: B }, wrapper: 'restoreDebt', mutation: true },
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
  'createSpaceTransfer',
  'moveEntryToSpace',
  'reconcileBalance',
  'archiveAccount',
  'loadRuangShell',
  'createReimbursement',
  'openReimbursables',
  'setBudget',
  'deleteBudget',
  'copyBudgets',
  'createBill',
  'updateBill',
  'archiveBill',
  'payBill',
  'setOccurrenceSkipped',
  'createContact',
  'renameContact',
  'archiveContact',
  'createDebt',
  'updateDebtInfo',
  'payDebt',
  'voidDebt',
  'restoreDebt',
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
  m.markNoSpendDay.mockResolvedValue({ created: true });
  m.listAccounts.mockResolvedValue([]);
  m.listCategories.mockResolvedValue([]);
  m.suggestCategories.mockResolvedValue([A, B]);
  m.getEntry.mockResolvedValue({ entry: { id: B, version: 2 }, history: [] });
  m.recordProductEvent.mockResolvedValue(undefined);
  m.createSpaceTransfer.mockResolvedValue({
    entryId: D,
    linkedEntryId: C,
    linkId: B,
    version: 1,
    replayed: false,
  });
  m.moveEntryToSpace.mockResolvedValue({ entryId: D, version: 1, replayed: false });
  m.reconcileBalance.mockResolvedValue({ entryId: D, difference: -5_000, replayed: false });
  m.archiveAccount.mockResolvedValue({ archived: true });
  m.loadRuangShell.mockResolvedValue({ accounts: [], categories: [] });
  m.createReimbursement.mockResolvedValue({ entryId: D, remaining: 200_000, replayed: false });
  m.openReimbursables.mockResolvedValue([]);
  m.setBudget.mockResolvedValue(undefined);
  m.deleteBudget.mockResolvedValue(undefined);
  m.copyBudgets.mockResolvedValue({
    copied: 2,
    skippedExisting: 0,
    skippedConflict: 1,
    skippedArchived: 0,
    skippedParent: 0,
  });
  m.createBill.mockResolvedValue({ billId: A });
  m.updateBill.mockResolvedValue({ billId: A });
  m.archiveBill.mockResolvedValue({ billId: A });
  m.payBill.mockResolvedValue({
    entryId: D,
    occurrenceId: B,
    version: 1,
    replayed: false,
    warnings: [],
  });
  m.setOccurrenceSkipped.mockResolvedValue({ skipped: true });
  m.createContact.mockResolvedValue({ contactId: A, name: 'Budi', replayed: false });
  m.renameContact.mockResolvedValue({ contactId: A, name: 'Budi S' });
  m.archiveContact.mockResolvedValue({ contactId: A });
  m.createDebt.mockResolvedValue({ debtId: A, contactId: B, entryId: D, version: 1 });
  m.updateDebtInfo.mockResolvedValue({ debtId: A });
  m.payDebt.mockResolvedValue({ entryId: D, debtId: B, version: 1 });
  m.voidDebt.mockResolvedValue({ debtId: B, affected: [D], effects: [], replayed: false });
  m.restoreDebt.mockResolvedValue({ debtId: B, affected: [D], effects: [], replayed: false });
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
    const files = actionFiles(dir);
    const seen: string[] = [];
    for (const file of files) {
      const { names, violations } = scanActionFile(
        file,
        readFileSync(path.join(dir, file), 'utf8'),
      );
      expect(violations).toEqual([]);
      seen.push(...names);
    }
    // WhatsApp = tingkat akun (`accountContext()`, tanpa ruang); perilakunya diuji di `wa.test.ts`.
    expect(seen.sort()).toEqual([...NAMES, 'createLinkCode', 'unlinkWa'].sort());
  });

  it('pemindai menolak bentuk yang melompati gerbang', () => {
    const head = "'use server';\n\n";
    const ok = `${head}export async function a(ruang: unknown): Promise<X> {\n  return mutate('a', actionContext(ruang), async () => 1);\n}\n`;
    expect(scanActionFile('ok.ts', ok).violations).toEqual([]);
    // Pembungkus lain (tanpa pemetaan galat yang dikenal).
    expect(
      scanActionFile('x.ts', ok.replace('return mutate(', 'return run(')).violations,
    ).toHaveLength(1);
    // Nama log tidak sama dengan nama fungsi.
    expect(scanActionFile('x.ts', ok.replace("mutate('a'", "mutate('b'")).violations).toHaveLength(
      1,
    );
    // Kerja sebelum gerbang.
    expect(
      scanActionFile('x.ts', ok.replace('  return mutate(', '  await db();\n  return mutate('))
        .violations,
    ).toHaveLength(1);
    // Ekspor arrow di berkas 'use server' (endpoint tanpa pemindaian).
    expect(
      scanActionFile('x.ts', `${head}export const b = async (ruang: unknown) => db(ruang);\n`)
        .violations,
    ).toHaveLength(1);
    expect(
      scanActionFile('x.ts', `${head}const b = async () => 1;\nexport { b };\n`).violations,
    ).toHaveLength(1);
    expect(
      scanActionFile('x.ts', `${head}export default async function (ruang: unknown) {}\n`)
        .violations,
    ).toHaveLength(1);
    // Tipe boleh.
    expect(
      scanActionFile('x.ts', `${head}export interface A {\n  a: string;\n}\nexport type B = A;\n`)
        .violations,
    ).toEqual([]);
    // Action tanpa 'use server' = bukan endpoint, berarti salah taruh.
    expect(scanActionFile('x.ts', ok.slice(head.length)).violations).toHaveLength(1);
    // Komentar di atas direktif tetap berkas 'use server' (ekspor nilai tetap ditolak).
    const commented = `/** Action contoh. */\n// baris\n"use server"\n\nexport const b = 1;\n`;
    expect(scanActionFile('x.ts', commented).violations).toHaveLength(1);
    expect(scanActionFile('x.ts', `/* a */\n${ok}`).violations).toEqual([]);
  });

  it('pemindaian rekursif ke subdirektori (tes dan context.ts dilewati)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'actions-'));
    try {
      mkdirSync(path.join(dir, 'sub', 'dalam'), { recursive: true });
      for (const f of ['a.ts', 'context.ts', 'a.test.ts', 'sub/b.ts', 'sub/dalam/c.ts', 'sub/x.md'])
        writeFileSync(path.join(dir, f), '');
      expect(actionFiles(dir).sort()).toEqual(['a.ts', 'sub/b.ts', 'sub/dalam/c.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Berkas action (relatif, rekursif): `.ts` selain tes dan `context.ts` di akar. */
function actionFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((f) => f.split(path.sep).join('/'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'context.ts');
}

/** Direktif `'use server'` sesudah komentar dan spasi di awal berkas (kutip tunggal/ganda). */
function hasUseServer(src: string): boolean {
  const rest = src.replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, '');
  return /^(['"])use server\1;?/.test(rest);
}

const HELPERS = '(mutate|query|quietly)';

/**
 * Pelanggaran bentuk berkas action:
 * - berkas `'use server'` hanya boleh mengekspor `async function`, `interface`, dan `type`
 *   (setiap ekspor nilai lain = endpoint publik yang lolos pemindaian);
 * - `export async function` hanya di berkas `'use server'`;
 * - baris pertama badan: `return (mutate|query|quietly)('<nama>', actionContext(ruang)…`.
 *   Argumen dievaluasi kiri ke kanan, jadi actionContext (requireDataUser) dipanggil sebelum apa
 *   pun; pembungkus hanya meng-await hasilnya di dalam try untuk memetakan galat.
 */
function scanActionFile(file: string, src: string): { names: string[]; violations: string[] } {
  const violations: string[] = [];
  const useServer = hasUseServer(src);
  const fns = exportedAsyncFunctions(src);
  if (useServer) {
    for (const line of src.split('\n')) {
      if (
        /^\s*export\b/.test(line) &&
        !/^export (async function \w+|interface \w+|type \w+)/.test(line)
      )
        violations.push(`${file}: ekspor selain async function/interface/type: ${line.trim()}`);
    }
  } else if (fns.length > 0) {
    violations.push(`${file}: export async function tanpa 'use server'`);
  }
  for (const { name, firstLine } of fns) {
    const shape = new RegExp(
      `^return ${HELPERS}\\('${name}', (actionContext\\(ruang\\)|accountContext\\(\\))`,
    );
    if (!shape.test(firstLine)) violations.push(`${file}:${name}: ${firstLine}`);
  }
  return { names: fns.map((f) => f.name), violations };
}

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

describe('utang hanya Pribadi (B10)', () => {
  const UTANG = Object.keys(utang).filter((n) => n in CASES);

  it.each(UTANG)('Bersama = debt_personal_only tanpa menyentuh wrapper: %s', async (name) => {
    m.resolveSpace.mockResolvedValue({ spaceId: OTHER_SPACE, kind: 'shared' });
    await expect(call(name, 'bersama')).resolves.toEqual({
      ok: false,
      error: { code: 'debt_personal_only' },
    });
    for (const w of WRAPPERS) expect(m[w]).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('kontak ganda atau sekaligus kosong = invalid contactId; mode baru tanpa dompet = invalid accountId', async () => {
    const base = { clientId: A, direction: 'lent', principal: 1_000, mode: 'berjalan' };
    await expect(call('createDebtAction', 'pribadi', base)).resolves.toEqual({
      ok: false,
      error: { code: 'invalid', field: 'contactId' },
    });
    await expect(
      call('createDebtAction', 'pribadi', { ...base, contactId: B, contactName: 'Budi' }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'contactId' } });
    await expect(
      call('createDebtAction', 'pribadi', { ...base, contactId: B, mode: 'baru' }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'accountId' } });
    await expect(
      call('createDebtAction', 'pribadi', { ...base, contactId: B, accountId: C }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'accountId' } });
    expect(m.createDebt).not.toHaveBeenCalled();
  });
});

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

describe('Rencana (S9)', () => {
  const pgError = (code: string, message: string, detail?: string) =>
    Object.assign(new Error(message), { code, detail });

  it.each([
    ['setBudgetAction', 'setBudget', 'obligation_double'],
    ['createBillAction', 'createBill', 'obligation_double'],
    ['setBudgetAction', 'setBudget', 'category_not_root'],
    ['payBillAction', 'payBill', 'already_posted'],
    ['payBillAction', 'payBill', 'bill_account_kantor'],
    ['updateBillAction', 'updateBill', 'bill_archived'],
    ['skipBillAction', 'setOccurrenceSkipped', 'already_posted'],
  ] as const)('%s: DK422 %s → kode %s tanpa nominal, tanpa refresh', async (name, w, rule) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m[w].mockRejectedValue(pgError('DK422', rule, 'Rp 485.000 rahasia'));
    const r = await call(name);
    expect(r).toEqual({ ok: false, error: { code: rule } });
    expect(JSON.stringify(r)).not.toMatch(/485|rahasia/);
    expect(log).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('copy_budgets DK400 to_month = invalid field to_month', async () => {
    m.copyBudgets.mockRejectedValue(pgError('DK400', 'invalid_argument', 'to_month'));
    await expect(call('copyBudgetsAction')).resolves.toEqual({
      ok: false,
      error: { code: 'invalid', field: 'to_month' },
    });
  });

  it('input ditolak sebelum DB: bulan bukan YYYY-MM, nominal 0, tanggal 32, berakhir < mulai', async () => {
    for (const [name, input, field] of [
      ['setBudgetAction', { categoryId: A, month: '2026-11-01', amount: 1, wajib: false }, 'month'],
      ['setBudgetAction', { categoryId: A, month: '2026-11', amount: 0, wajib: true }, 'amount'],
      ['copyBudgetsAction', { toMonth: '2026-13' }, 'toMonth'],
      ['copyBudgetsAction', { toMonth: '0000-01' }, 'toMonth'],
      ['setBudgetAction', { categoryId: A, month: '9999-12', amount: 1, wajib: false }, 'month'],
      [
        'createBillAction',
        {
          clientId: A,
          name: 'X',
          amount: 1,
          categoryId: B,
          dayOfMonth: 32,
          startsOn: '2026-11-01',
        },
        'dayOfMonth',
      ],
      [
        'createBillAction',
        {
          clientId: A,
          name: 'X',
          amount: 1,
          categoryId: B,
          dayOfMonth: 5,
          startsOn: '2026-11-01',
          endsOn: '2026-10-31',
        },
        'endsOn',
      ],
      ['payBillAction', { clientId: A, occurrenceId: B, amount: 0 }, 'amount'],
      ['payBillAction', { clientId: A, occurrenceId: B, occurredOn: '0001-01-01' }, 'occurredOn'],
    ] as const) {
      await expect(call(name, 'pribadi', input)).resolves.toEqual({
        ok: false,
        error: { code: 'invalid', field },
      });
    }
    for (const w of WRAPPERS) expect(m[w]).not.toHaveBeenCalled();
  });

  it('sukses: hasil wrapper diteruskan, refresh sekali', async () => {
    await expect(call('copyBudgetsAction')).resolves.toEqual({
      ok: true,
      value: {
        copied: 2,
        skippedExisting: 0,
        skippedConflict: 1,
        skippedArchived: 0,
        skippedParent: 0,
      },
    });
    expect(m.copyBudgets).toHaveBeenCalledWith(
      { pools: POOLS, userId: USER_ID, spaceId: SPACE_ID },
      { toMonth: '2026-11', adjustPct: 0 },
    );
    expect(m.refresh).toHaveBeenCalledTimes(1);
    await call('unskipBillAction');
    expect(m.setOccurrenceSkipped).toHaveBeenLastCalledWith(expect.anything(), B, false);
    await call('skipBillAction');
    expect(m.setOccurrenceSkipped).toHaveBeenLastCalledWith(expect.anything(), B, true);
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
      call('saveCatat', 'pribadi', { kind: 'adjustment', clientId: A, amount: 1 }),
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

  it('ZodError kontrak hasil (bukan input) = unknown, log hanya nama + ZodError', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Bentuk galat `entryResult.parse(rows[0]?.r)` di dalam callApi bila jsonb api.* berubah.
    const { z } = await import('zod');
    const contract = z.object({ entry_id: z.uuid(), version: z.number().int() });
    const broken = contract.safeParse({ entry_id: 'Rp 35.000 kopi', version: 'x' }).error;
    m.createEntry.mockRejectedValue(broken);
    await expect(call('saveCatat')).resolves.toEqual({ ok: false, error: { code: 'unknown' } });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[ledger action]', 'saveCatat', 'ZodError');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/entry_id|35\.000|kopi/);
  });

  it('ZodError dari loader baca = unknown, bukan invalid', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { z } = await import('zod');
    m.suggestCategories.mockRejectedValue(z.uuid().safeParse('x').error);
    await expect(call('suggestFor')).resolves.toEqual({ ok: false, error: { code: 'unknown' } });
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

  it('tanda ulang di hari yang sama (created: false): tanpa event kedua', async () => {
    m.markNoSpendDay
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: false });
    await expect(call('markNoSpendDayAction')).resolves.toEqual({ ok: true, value: undefined });
    await expect(call('markNoSpendDayAction')).resolves.toEqual({ ok: true, value: undefined });
    expect(m.markNoSpendDay).toHaveBeenCalledTimes(2);
    expect(m.recordProductEvent).toHaveBeenCalledTimes(1);
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

/** Pribadi = SPACE_ID, Bersama = OTHER_SPACE (resolve per slug, seperti DB). */
function twoSpaces(): void {
  m.resolveSpace.mockImplementation((_pools: unknown, _uid: unknown, ruang: unknown) =>
    Promise.resolve(
      ruang === 'bersama'
        ? { spaceId: OTHER_SPACE, kind: 'shared' }
        : { spaceId: SPACE_ID, kind: 'personal' },
    ),
  );
}

const SPACE_TRANSFER = {
  kind: 'space_transfer',
  clientId: A,
  fromAccountId: B,
  toRuang: 'bersama',
  toAccountId: C,
  amount: 250_000,
};

describe('S7: transfer antar ruang lewat saveCatat', () => {
  beforeEach(twoSpaces);

  it('Pribadi → Bersama: toSpaceId di-resolve server dari slug; hasil tanpa id kaki lain', async () => {
    const r = await call('saveCatat', 'pribadi', {
      ...SPACE_TRANSFER,
      description: 'bayar kos adik',
      sharedNote: 'Setoran November',
    });
    expect(r).toEqual({ ok: true, value: { entryId: D, version: 1, replayed: false } });
    expect(m.createSpaceTransfer).toHaveBeenCalledWith(
      { pools: POOLS, userId: USER_ID, spaceId: SPACE_ID },
      {
        clientId: A,
        fromAccountId: B,
        toSpaceId: OTHER_SPACE,
        toAccountId: C,
        amount: 250_000,
        fee: 0,
        allowNegative: false,
        description: 'bayar kos adik',
        sharedNote: 'Setoran November',
      },
    );
    expect(m.resolveSpace).toHaveBeenNthCalledWith(1, POOLS, USER_ID, 'pribadi');
    expect(m.resolveSpace).toHaveBeenNthCalledWith(2, POOLS, USER_ID, 'bersama');
    expect(m.createEntry).not.toHaveBeenCalled();
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it('dari /bersama ke Pribadi: hasil tidak memuat id kaki Pribadi (linkedEntryId/linkId)', async () => {
    const r = await call('saveCatat', 'bersama', {
      ...SPACE_TRANSFER,
      toRuang: 'pribadi',
      fee: 2_500,
      allowNegative: true,
    });
    expect(r).toEqual({ ok: true, value: { entryId: D, version: 1, replayed: false } });
    expect(JSON.stringify(r)).not.toContain(C);
    expect(JSON.stringify(r)).not.toContain(B);
    expect(m.createSpaceTransfer).toHaveBeenCalledWith(
      { pools: POOLS, userId: USER_ID, spaceId: OTHER_SPACE },
      expect.objectContaining({ toSpaceId: SPACE_ID, fee: 2_500, allowNegative: true }),
    );
  });

  it.each([
    ['ruang sama', { toRuang: 'pribadi' }, 'toRuang'],
    ['ruang tujuan tidak dikenal', { toRuang: 'kantor' }, 'toRuang'],
    ['toRuang hilang', { toRuang: undefined }, 'toRuang'],
    ['uuid ruang mentah dari klien', { toSpaceId: OTHER_SPACE }, 'toSpaceId'],
    [
      'uuid ruang mentah menggantikan slug',
      { toRuang: undefined, toSpaceId: OTHER_SPACE },
      'toRuang',
    ],
    ['biaya negatif', { fee: -1 }, 'fee'],
  ])('%s = invalid, tanpa wrapper', async (_label, patch, field) => {
    await expect(call('saveCatat', 'pribadi', { ...SPACE_TRANSFER, ...patch })).resolves.toEqual({
      ok: false,
      error: { code: 'invalid', field },
    });
    for (const w of WRAPPERS) expect(m[w]).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('kunci asing ditolak (bukan diabaikan) pada transfer antar ruang', async () => {
    await expect(
      call('saveCatat', 'pribadi', { ...SPACE_TRANSFER, spaceId: OTHER_SPACE }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(m.createSpaceTransfer).not.toHaveBeenCalled();
  });

  it('ruang tujuan bukan anggota = not_found', async () => {
    m.resolveSpace.mockImplementation((_p: unknown, _u: unknown, ruang: unknown) =>
      ruang === 'bersama'
        ? Promise.reject(new SpaceNotFoundError())
        : Promise.resolve({ spaceId: SPACE_ID, kind: 'personal' }),
    );
    await expect(call('saveCatat', 'pribadi', SPACE_TRANSFER)).resolves.toEqual({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(m.createSpaceTransfer).not.toHaveBeenCalled();
  });

  it('cross_space_kantor dari DB diteruskan', async () => {
    m.createSpaceTransfer.mockRejectedValue(
      Object.assign(new Error('cross_space_kantor'), { code: 'DK422' }),
    );
    await expect(call('saveCatat', 'pribadi', SPACE_TRANSFER)).resolves.toEqual({
      ok: false,
      error: { code: 'cross_space_kantor' },
    });
  });
});

describe('S7: talangan lewat saveCatat', () => {
  beforeEach(twoSpaces);
  const expense = { kind: 'expense', clientId: A, accountId: B, amount: 500_000, categoryId: C };

  it('pengeluaran Pribadi reimbursable diteruskan ke createEntry', async () => {
    await expect(
      call('saveCatat', 'pribadi', { ...expense, reimbursable: true }),
    ).resolves.toMatchObject({ ok: true });
    expect(m.createEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reimbursable: true }),
    );
  });

  it.each([
    ['Bersama', 'bersama', expense],
    ['pemasukan', 'pribadi', { ...expense, kind: 'income' }],
  ])('talangan di %s = invalid reimbursable, tanpa DB', async (_l, ruang, input) => {
    await expect(call('saveCatat', ruang, { ...input, reimbursable: true })).resolves.toEqual({
      ok: false,
      error: { code: 'invalid', field: 'reimbursable' },
    });
    expect(m.createEntry).not.toHaveBeenCalled();
  });

  it('reimbursable false di Bersama tetap boleh', async () => {
    await expect(
      call('saveCatat', 'bersama', { ...expense, reimbursable: false }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe('S7: pindahkan ke ruang lain', () => {
  beforeEach(twoSpaces);
  const move = {
    clientId: A,
    entryId: B,
    expectedVersion: 1,
    toRuang: 'bersama',
    accountId: C,
    categoryId: D,
  };

  it('Pribadi → Bersama: keepDescription diteruskan; hasil id entri Bersama baru', async () => {
    await expect(
      call('moveEntryAction', 'pribadi', { ...move, keepDescription: true }),
    ).resolves.toEqual({ ok: true, value: { toRuang: 'bersama', entryId: D, replayed: false } });
    expect(m.moveEntryToSpace).toHaveBeenCalledWith(
      { pools: POOLS, userId: USER_ID, spaceId: SPACE_ID },
      {
        clientId: A,
        entryId: B,
        expectedVersion: 1,
        toSpaceId: OTHER_SPACE,
        accountId: C,
        categoryId: D,
        keepDescription: true,
      },
    );
  });

  it('dari /bersama ke Pribadi: hasil tanpa id entri Pribadi baru', async () => {
    const r = await call('moveEntryAction', 'bersama', { ...move, toRuang: 'pribadi' });
    expect(r).toEqual({ ok: true, value: { toRuang: 'pribadi', replayed: false } });
    expect(JSON.stringify(r)).not.toContain(D);
    expect(m.moveEntryToSpace).toHaveBeenCalledWith(
      { pools: POOLS, userId: USER_ID, spaceId: OTHER_SPACE },
      expect.objectContaining({ toSpaceId: SPACE_ID }),
    );
  });

  it.each([
    ['ruang sama', { toRuang: 'pribadi' }, 'toRuang'],
    ['ruang tujuan tidak dikenal', { toRuang: 'kantor' }, 'toRuang'],
    ['uuid ruang mentah', { toSpaceId: OTHER_SPACE }, 'toSpaceId'],
    ['versi 0', { expectedVersion: 0 }, 'expectedVersion'],
  ])('%s = invalid', async (_l, patch, field) => {
    await expect(call('moveEntryAction', 'pribadi', { ...move, ...patch })).resolves.toEqual({
      ok: false,
      error: { code: 'invalid', field },
    });
    expect(m.moveEntryToSpace).not.toHaveBeenCalled();
  });

  it.each(['not_creator', 'kind_not_movable', 'entry_moved', 'cross_space_kantor'])(
    '%s dari DB diteruskan',
    async (code) => {
      m.moveEntryToSpace.mockRejectedValue(Object.assign(new Error(code), { code: 'DK422' }));
      await expect(call('moveEntryAction', 'pribadi', move)).resolves.toEqual({
        ok: false,
        error: { code },
      });
      expect(m.refresh).not.toHaveBeenCalled();
    },
  );

  it('moveTargetsAction: dompet aktif non-kantor + kategori aktif ruang tujuan', async () => {
    m.loadRuangShell.mockResolvedValue({
      accounts: [
        { id: A, pocket: 'operasional', archived: false },
        { id: B, pocket: 'kantor', archived: false },
        { id: C, pocket: 'tabungan', archived: true },
        { id: D, pocket: 'tabungan', archived: false },
      ],
      categories: [{ id: A }],
    });
    await expect(call('moveTargetsAction', 'pribadi', 'bersama')).resolves.toEqual({
      ok: true,
      value: {
        accounts: [
          { id: A, pocket: 'operasional', archived: false },
          { id: D, pocket: 'tabungan', archived: false },
        ],
        categories: [{ id: A }],
      },
    });
    expect(m.loadRuangShell).toHaveBeenCalledWith({
      pools: POOLS,
      userId: USER_ID,
      spaceId: OTHER_SPACE,
    });
  });

  it.each([['pribadi'], ['kantor'], [OTHER_SPACE]])(
    'moveTargetsAction tujuan %s dari /pribadi = invalid toRuang',
    async (toRuang) => {
      await expect(call('moveTargetsAction', 'pribadi', toRuang)).resolves.toEqual({
        ok: false,
        error: { code: 'invalid', field: 'toRuang' },
      });
      expect(m.loadRuangShell).not.toHaveBeenCalled();
    },
  );
});

describe('S7: dompet (cocokkan, arsip)', () => {
  it('reconcileAction meneruskan saldo nyata; hasil selisih', async () => {
    await expect(call('reconcileAction')).resolves.toEqual({
      ok: true,
      value: { entryId: D, difference: -5_000, replayed: false },
    });
    expect(m.reconcileBalance).toHaveBeenCalledWith(
      { pools: POOLS, userId: USER_ID, spaceId: SPACE_ID },
      { clientId: A, accountId: B, actualBalance: 125_000 },
    );
  });

  it('reconcileAction saldo nyata pecahan = invalid actualBalance', async () => {
    await expect(
      call('reconcileAction', 'pribadi', { clientId: A, accountId: B, actualBalance: 1.5 }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid', field: 'actualBalance' } });
  });

  it('archiveAccountAction: id bukan uuid = invalid; saldo ≠ 0 = balance_not_zero', async () => {
    await expect(call('archiveAccountAction')).resolves.toEqual({
      ok: true,
      value: { archived: true },
    });
    await expect(call('archiveAccountAction', 'pribadi', 'x')).resolves.toEqual({
      ok: false,
      error: { code: 'invalid', field: 'accountId' },
    });
    m.archiveAccount.mockRejectedValue(
      Object.assign(new Error('balance_not_zero'), { code: 'DK422' }),
    );
    await expect(call('archiveAccountAction')).resolves.toEqual({
      ok: false,
      error: { code: 'balance_not_zero' },
    });
  });
});

describe('S7: reimburse', () => {
  it('createReimbursementAction: hasil sisa; melebihi = reimbursement_exceeds', async () => {
    await expect(call('createReimbursementAction')).resolves.toEqual({
      ok: true,
      value: { entryId: D, remaining: 200_000, replayed: false },
    });
    m.createReimbursement.mockRejectedValue(
      Object.assign(new Error('reimbursement_exceeds'), { code: 'DK422' }),
    );
    await expect(call('createReimbursementAction')).resolves.toEqual({
      ok: false,
      error: { code: 'reimbursement_exceeds' },
    });
  });

  it('openReimbursablesAction: Pribadi membaca; Bersama = kosong tanpa DB', async () => {
    twoSpaces();
    m.openReimbursables.mockResolvedValue([{ entryId: B, remaining: 1 }]);
    await expect(call('openReimbursablesAction', 'pribadi')).resolves.toEqual({
      ok: true,
      value: [{ entryId: B, remaining: 1 }],
    });
    m.openReimbursables.mockClear();
    await expect(call('openReimbursablesAction', 'bersama')).resolves.toEqual({
      ok: true,
      value: [],
    });
    expect(m.openReimbursables).not.toHaveBeenCalled();
  });
});
