import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UtangFailed, UtangPageView } from './utang';
import { UtangSection } from './utang-section';
import { UtangHostIsland } from './utang-islands';

/** UtangSection: loader per bagian lewat konteks yang sudah lolos gerbang; galat = ErrorState di dalam bagian. */

const h = vi.hoisted(() => ({ load: vi.fn(), accounts: vi.fn() }));

vi.mock('@/server/ledger/utang', () => ({ loadUtang: (...a: unknown[]): unknown => h.load(...a) }));
vi.mock('./context', () => ({ ruangAccounts: (...a: unknown[]): unknown => h.accounts(...a) }));
vi.mock('./utang', () => ({
  UtangFailed: () => null,
  UtangPageView: () => null,
  UtangDetailView: () => null,
}));
vi.mock('./utang-islands', () => ({
  UtangHostIsland: () => null,
  AddDebtIsland: () => null,
  PayRowIsland: () => null,
  RestoreDebtIsland: () => null,
  CancelPaymentIsland: () => null,
  DeleteDebtIsland: () => null,
  EditDebtIsland: () => null,
  PayDetailIsland: () => null,
}));

const CTX = {
  pools: {},
  userId: 'u',
  spaceId: 's',
  ruang: 'pribadi' as const,
  kind: 'personal',
} as unknown as Parameters<typeof UtangSection>[0]['ctx'];
const DATA = {
  debts: [
    { debtId: 'd1', voidedAt: null, contactName: 'Budi' },
    { debtId: 'd2', voidedAt: 'x', contactName: 'Eko' },
  ],
  totals: {},
  contacts: [],
};

async function run(): Promise<ReactElement> {
  const el: unknown = await UtangSection({ ctx: CTX, query: '?theme=light' });
  if (!isValidElement(el)) throw new Error('bukan elemen');
  return el;
}

beforeEach(() => {
  h.load.mockResolvedValue(DATA);
  h.accounts.mockResolvedValue([{ id: 'a1' }]);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('UtangSection', () => {
  it('memuat lewat loadUtang(ctx) dan dompet ruang ini; hanya utang hidup jadi target Bayar', async () => {
    const el = await run();
    expect(h.load).toHaveBeenCalledWith(CTX);
    expect(h.accounts).toHaveBeenCalledWith(CTX);
    expect(el.type).toBe(UtangHostIsland);
    const p = el.props as { targets: { debtId: string }[]; ruang: string; listHref: string };
    expect(p.ruang).toBe('pribadi');
    expect(p.targets.map((t) => t.debtId)).toEqual(['d1']);
    expect(p.listHref).toBe('/pribadi/rencana?theme=light&bagian=utang');
    const view = (p as unknown as { children: ReactElement }).children;
    expect(view.type).toBe(UtangPageView);
  });

  it('galat loader = UtangFailed di dalam bagian; log tanpa pesan galat', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.load.mockRejectedValue(new Error('detail rahasia: Rp 12345'));
    const el = await run();
    expect(el.type).toBe(UtangFailed);
    expect(el.props).toEqual({ ruang: 'pribadi', query: '?theme=light' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('rahasia');
  });
});
