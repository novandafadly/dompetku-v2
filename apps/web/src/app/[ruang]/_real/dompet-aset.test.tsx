import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountVM, AssetOverviewVM, EntryVM, NetWorthVM } from '@/features/ledger/types';
import type { DompetRiwayat } from '@/server/ledger/dompet';
import { DompetReal } from './dompet';
import { DompetDetailReal } from './dompet-detail';

afterEach(cleanup);

vi.mock('./aset-islands', () => ({
  AddAssetHostIsland: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AddAssetTriggerIsland: ({ variant }: { variant?: string }) => (
    <button type="button" data-variant={variant}>
      Tambah aset
    </button>
  ),
  RevalueIsland: ({ asset }: { asset: { name: string; lastOn: string | null } }) => (
    <button type="button" data-testid="revalue" data-last={asset.lastOn ?? ''}>
      Perbarui nilai
    </button>
  ),
  AssetTransferIsland: ({ account }: { account: { balance: number } }) => (
    <div data-testid="transfer" data-balance={account.balance} />
  ),
}));
vi.mock('./saham-islands', () => ({
  StockButtonIsland: ({ label }: { label: string }) => <button type="button">{label}</button>,
  VoidTradeIsland: () => <button type="button">Batalkan</button>,
}));
vi.mock('./dompet-islands', () => ({
  AddWalletHostIsland: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AddWalletTriggerIsland: () => <button type="button">Tambah dompet</button>,
}));
vi.mock('./dompet-actions-islands', () => ({
  ReconcileIsland: () => <button type="button">Cocokkan saldo</button>,
  ArchiveIsland: (p: { asset?: boolean }) => (
    <button type="button">{p.asset === true ? 'Arsipkan aset' : 'Arsipkan dompet'}</button>
  ),
}));
vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));
vi.mock('@/features/shell/page-header', () => ({
  PageHeader: ({ title, action }: { title: string; action?: ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {action}
    </header>
  ),
}));

const nw = (over: Partial<NetWorthVM> = {}): NetWorthVM => ({
  kas: 1_000_000,
  aset: 0,
  sahamPasar: 0,
  sahamTanpaHarga: 0,
  piutang: 0,
  utang: 0,
  total: 1_000_000,
  priceAsOf: null,
  monthAgoTotal: null,
  monthAgoOn: null,
  ...over,
});

const acc = (over: Partial<AccountVM> & Pick<AccountVM, 'id' | 'name' | 'balance'>): AccountVM => ({
  pocket: 'operasional',
  walletType: 'bank',
  openedOn: '2026-11-01',
  archived: false,
  ...over,
});

const emas = acc({
  id: 'as1',
  name: 'Emas Antam',
  pocket: 'aset',
  walletType: 'cash',
  assetKind: 'emas',
  balance: 5_000_000,
});
const bca = acc({ id: 'a1', name: 'BCA', balance: 1_000_000 });

const render1 = (props: Partial<Parameters<typeof DompetReal>[0]> = {}) =>
  render(
    <DompetReal
      ruang="pribadi"
      query=""
      today="2026-11-16"
      accounts={[bca, emas]}
      reimbursables={[]}
      archived={[]}
      netWorth={nw()}
      {...props}
    />,
  );

describe('Dompet S14: hero Kekayaan bersih dari SQL', () => {
  it('total dan komponen dari VM (tidak dijumlah dari daftar); komponen 0 tidak dirender; Utang minus', () => {
    render1({
      netWorth: nw({
        kas: 1_000_000,
        aset: 5_000_000,
        utang: 800_000,
        piutang: 300_000,
        total: 5_500_000,
      }),
    });
    expect(screen.getByTestId('net-worth')).toHaveTextContent('5.500.000');
    const parts = screen.getByTestId('net-worth-parts');
    const labels = within(parts)
      .getAllByRole('term')
      .map((t) => t.textContent);
    // Urutan Kas · Aset · Piutang · Utang; Saham (0) tidak dirender.
    expect(labels).toEqual(['Kas', 'Aset', 'Piutang', 'Utang']);
    expect(parts).toHaveTextContent('−Rp');
    expect(parts).toHaveTextContent('800.000');
  });

  it('hanya Kas: tanpa rincian; tanpa 30 hari lalu bila belum ada snapshot', () => {
    render1();
    expect(screen.queryByTestId('net-worth-parts')).toBeNull();
    expect(screen.queryByTestId('net-worth-month-ago')).toBeNull();
    expect(
      screen.getByText('Kas, aset, saham, dan sisa utang-piutang. Kas Kantor tidak dihitung.'),
    ).toBeTruthy();
  });

  it('30 hari lalu: nominal lampau saja (tanpa selisih/persen); bukan tepat 30 hari = tanggalnya', () => {
    const { rerender } = render1({
      netWorth: nw({ monthAgoTotal: 900_000, monthAgoOn: '2026-10-17' }),
    });
    expect(screen.getByTestId('net-worth-month-ago')).toHaveTextContent('30 hari lalu');
    expect(screen.getByTestId('net-worth-month-ago')).toHaveTextContent('900.000');
    expect(screen.getByTestId('net-worth-month-ago').textContent).not.toMatch(/[%▲▼]/);
    rerender(
      <DompetReal
        ruang="pribadi"
        query=""
        today="2026-11-16"
        accounts={[bca, emas]}
        reimbursables={[]}
        archived={[]}
        netWorth={nw({ monthAgoTotal: 900_000, monthAgoOn: '2026-10-15' })}
      />,
    );
    expect(screen.getByTestId('net-worth-month-ago')).toHaveTextContent('15 Okt');
    expect(screen.getByTestId('net-worth-month-ago')).not.toHaveTextContent('30 hari lalu');
  });

  it('saham: label tanggal harga; sebagian tanpa harga = penjelasan dinilai sebesar biaya beli', () => {
    const { rerender } = render1({
      netWorth: nw({ sahamPasar: 2_000_000, total: 3_000_000, priceAsOf: '2026-11-14' }),
    });
    expect(screen.getByText('Harga saham 14 Nov 2026')).toBeTruthy();
    rerender(
      <DompetReal
        ruang="pribadi"
        query=""
        today="2026-11-16"
        accounts={[bca, emas]}
        reimbursables={[]}
        archived={[]}
        netWorth={nw({ sahamPasar: 2_000_000, sahamTanpaHarga: 1, total: 3_000_000 })}
      />,
    );
    expect(
      screen.getByText('Sebagian saham belum ada harga, jadi dinilai sebesar biaya beli.'),
    ).toBeTruthy();
  });

  it('total minus tampil dengan tanda minus tanpa kelas warna bahaya', () => {
    render1({ netWorth: nw({ kas: 0, utang: 500_000, total: -500_000 }) });
    const total = screen.getByTestId('net-worth');
    expect(total).toHaveTextContent('−Rp');
    expect(total.innerHTML).not.toMatch(/text-danger|text-income/);
  });

  it('Bersama: subjudul menurut keberadaan aset; tanpa nama Piutang/Utang', () => {
    const { unmount } = render1({
      ruang: 'bersama',
      netWorth: nw({ aset: 100, total: 1_000_100 }),
    });
    expect(screen.getByText('Kas dan aset bersama.')).toBeTruthy();
    unmount();
    render1({ ruang: 'bersama' });
    expect(screen.getByText('Kas Bersama.')).toBeTruthy();
  });

  it('galat loader: hero tetap dengan CardError dan Coba lagi; daftar dompet tetap tampil', () => {
    render1({ netWorth: 'error' });
    expect(screen.getByText('Kekayaan bersih belum bisa dimuat.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Coba lagi' })).toHaveAttribute(
      'href',
      '/pribadi/dompet',
    );
    expect(screen.queryByTestId('net-worth')).toBeNull();
    expect(screen.getByRole('link', { name: /BCA/ })).toBeTruthy();
  });
});

describe('Dompet S14: kelompok Aset', () => {
  it('kelompok Aset sesudah dompet lain, tanpa subtotal; baris dengan label jenis dan nilai', () => {
    render1();
    const group = screen.getByRole('region', { name: 'Aset' });
    expect(within(group).getByRole('link', { name: /Emas Antam/ })).toHaveTextContent('Emas');
    expect(group).toHaveTextContent('5.000.000');
    // Subtotal kelompok tidak ada: hanya satu nominal di grup (nilai baris).
    expect(group.querySelectorAll('.num').length).toBe(1);
    const ops = screen.getByRole('region', { name: 'Operasional' });
    expect(ops.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('aset bernilai 0 = Belum ada nilai (bukan Rp 0)', () => {
    render1({ accounts: [bca, { ...emas, balance: 0 }] });
    const group = screen.getByRole('region', { name: 'Aset' });
    expect(group).toHaveTextContent('Belum ada nilai');
    expect(group).not.toHaveTextContent('Rp');
  });

  it('dompet saham: nilai pasar dari ringkasan SQL, bukan saldo buku; sebagian tanpa harga disebut', () => {
    const saham = acc({
      id: 's1',
      name: 'Ajaib',
      pocket: 'aset',
      walletType: 'cash',
      assetKind: 'saham',
      balance: 1_000_000,
    });
    const ov = (over: Partial<AssetOverviewVM>): AssetOverviewVM => ({
      accountId: 's1',
      name: 'Ajaib',
      assetKind: 'saham',
      balance: 1_000_000,
      lastValuedOn: null,
      lastChange: null,
      marketValue: 1_250_000,
      missingPriceCount: 0,
      ...over,
    });
    const { unmount } = render1({ accounts: [bca, saham], assets: [ov({})] });
    let row = screen.getByRole('link', { name: /Ajaib/ });
    expect(row).toHaveTextContent('1.250.000');
    expect(row).not.toHaveTextContent('1.000.000');
    expect(row).toHaveTextContent('Saham · nilai pasar');
    unmount();
    render1({ accounts: [bca, saham], assets: [ov({ missingPriceCount: 1 })] });
    row = screen.getByRole('link', { name: /Ajaib/ });
    expect(row).toHaveTextContent('Saham · sebagian belum ada harga');
    cleanup();
    render1({ accounts: [bca, { ...saham, balance: 0 }], assets: [ov({ marketValue: 0 })] });
    expect(screen.getByRole('link', { name: /Ajaib/ })).toHaveTextContent('Belum ada saham');
  });

  it('tautan Tambah aset di isi (HP) dan header (laptop)', () => {
    render1();
    expect(screen.getAllByRole('button', { name: 'Tambah aset' }).length).toBe(2);
  });

  it('daftar kosong: EmptyState lama + Tambah aset', () => {
    render1({ accounts: [] });
    expect(screen.getByText('Belum ada dompet di Pribadi.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Tambah aset' }).length).toBeGreaterThan(0);
  });
});

const by = { id: 'u1', name: 'Novanda', initial: 'N' };
const entry = (id: string, over: Partial<EntryVM>): EntryVM => ({
  id,
  version: 1,
  kind: 'transfer',
  occurredOn: '2026-11-10',
  createdAt: '2026-11-10T08:00:00+07:00',
  createdBy: by,
  accountId: 'a1',
  accountName: 'BCA',
  amount: 500_000,
  ...over,
});

describe('Detail aset (S14-AS3)', () => {
  const data: DompetRiwayat = {
    account: emas,
    entries: [
      entry('e-1', {
        kind: 'valuation',
        accountId: 'as1',
        accountName: 'Emas Antam',
        amount: 300_000,
        direction: 'in',
      }),
      entry('e-2', {
        kind: 'valuation',
        accountId: 'as1',
        accountName: 'Emas Antam',
        amount: 100_000,
        direction: 'out',
        occurredOn: '2026-11-09',
      }),
      entry('e-3', { counterAccountId: 'as1', counterAccountName: 'Emas Antam' }),
      entry('e-4', {
        accountId: 'as1',
        accountName: 'Emas Antam',
        counterAccountId: 'a1',
        counterAccountName: 'BCA',
        amount: 200_000,
        occurredOn: '2026-11-08',
      }),
    ],
    opening: [
      entry('e-0', {
        kind: 'opening_balance',
        accountId: 'as1',
        accountName: 'Emas Antam',
        amount: 4_000_000,
        occurredOn: '2026-11-01',
      }),
    ],
    hasMore: false,
  };
  const overview: AssetOverviewVM = {
    accountId: 'as1',
    name: 'Emas Antam',
    assetKind: 'emas',
    balance: 5_000_000,
    lastValuedOn: '2026-11-10',
    lastChange: 300_000,
    marketValue: null,
    missingPriceCount: null,
  };
  const props = {
    ruang: 'pribadi' as const,
    today: '2026-11-12',
    query: '',
    dompetHref: '/pribadi/dompet' as never,
    moreHref: null,
    data,
    accounts: [bca, emas],
    asset: overview,
  };

  it('label Nilai {nama}, jenis + tanggal valuasi terakhir; tanpa kata Saldo; Perbarui nilai dan Isi/Cairkan', () => {
    render(<DompetDetailReal {...props} />);
    expect(screen.getByText('Nilai Emas Antam')).toBeTruthy();
    expect(screen.queryByText('Saldo')).toBeNull();
    expect(screen.getByTestId('wallet-balance')).toHaveTextContent('5.000.000');
    expect(screen.getByText('Emas · diperbarui 10 Nov')).toBeTruthy();
    expect(screen.getByTestId('revalue')).toHaveAttribute('data-last', '2026-11-10');
    expect(screen.getByTestId('transfer')).toHaveAttribute('data-balance', '5000000');
    expect(screen.queryByText('Cocokkan saldo')).toBeNull();
    expect(
      screen.getByText('Perubahan nilai tidak dihitung sebagai pemasukan atau pengeluaran.'),
    ).toBeTruthy();
  });

  it('tanpa valuasi: "nilai sejak"; Ubah nilai awal (≤ 7 hari) menggantikan Ubah saldo awal', () => {
    render(
      <DompetDetailReal
        {...props}
        today="2026-11-05"
        asset={{ ...overview, lastValuedOn: null }}
      />,
    );
    expect(screen.getByText('Emas · nilai sejak 1 Nov')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ubah nilai awal Emas Antam' })).toHaveTextContent(
      'Ubah nilai awal',
    );
    expect(screen.queryByText('Ubah saldo awal')).toBeNull();
  });

  it('riwayat: Perubahan nilai (+/− netral, Naik/Turun), Isi dari / Cair ke; entri pembuka = Nilai awal', () => {
    render(<DompetDetailReal {...props} />);
    const naik = screen.getAllByRole('link', { name: /Perubahan nilai/ });
    expect(naik).toHaveLength(2);
    expect(naik[0]).toHaveTextContent('Naik');
    expect(naik[0]).toHaveTextContent('+');
    expect(naik[1]).toHaveTextContent('Turun');
    expect(naik[1]).toHaveTextContent('−');
    expect(screen.getByRole('link', { name: /Isi dari BCA/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Cair ke BCA/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Nilai awal/ })).toBeTruthy();
  });

  it('nilai 0: Belum ada nilai dan arsip boleh; bernilai: arsip diganti kartu penjelasan aset', () => {
    const { unmount } = render(
      <DompetDetailReal
        {...props}
        data={{ ...data, account: { ...emas, balance: 0 } }}
        asset={{ ...overview, balance: 0 }}
      />,
    );
    expect(screen.getByTestId('wallet-balance')).toHaveTextContent('Belum ada nilai');
    expect(screen.getByRole('button', { name: 'Arsipkan aset' })).toBeTruthy();
    unmount();
    render(<DompetDetailReal {...props} />);
    expect(
      screen.getByText(
        'Emas Antam masih bernilai. Perbarui nilainya ke 0 atau cairkan ke dompet, lalu arsipkan.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Arsipkan aset' })).toBeNull();
  });

  it('dompet saham: tanpa aksi aset generik; kartu arsip menyebut saham; label nilai pasar dari SQL', () => {
    const saham = { ...emas, assetKind: 'saham' as const, name: 'Ajaib' };
    render(
      <DompetDetailReal
        {...props}
        data={{ ...data, account: saham, entries: [], opening: [] }}
        asset={{
          ...overview,
          assetKind: 'saham',
          name: 'Ajaib',
          marketValue: 6_000_000,
          missingPriceCount: 0,
        }}
        stock={{
          holdings: [
            {
              holdingId: 'h1',
              ticker: 'BBCA',
              shares: 600,
              costTotal: 5_000_000,
              avgCost: 8333,
              close: 10_000,
              closeOn: '2026-11-14',
              stale: false,
              heldPending: false,
              heldOn: null,
              marketValue: 6_000_000,
              unrealized: 1_000_000,
              realized: 0,
              lastTradeId: null,
              trades: [],
            },
          ],
          total: {
            costTotal: 5_000_000,
            marketValue: 6_000_000,
            unrealized: 1_000_000,
            realized: 0,
            stale: false,
            heldPending: false,
            missingPriceCount: 0,
          },
        }}
      />,
    );
    expect(screen.getByText('Nilai pasar Ajaib')).toBeTruthy();
    expect(screen.getByTestId('wallet-balance')).toHaveTextContent('6.000.000');
    expect(screen.queryByTestId('revalue')).toBeNull();
    expect(screen.queryByText('Cocokkan saldo')).toBeNull();
    expect(
      screen.getByText('Ajaib masih memegang saham. Jual semua saham dulu, lalu arsipkan.'),
    ).toBeTruthy();
  });

  it('tanpa ringkasan (gagal dimuat): saldo dan riwayat tetap, jenis tanpa tanggal', () => {
    render(<DompetDetailReal {...props} asset="error" />);
    expect(screen.getByText('Emas')).toBeTruthy();
    expect(screen.getByTestId('wallet-balance')).toHaveTextContent('5.000.000');
  });

  it('detail dompet biasa tidak berubah: Saldo, Cocokkan saldo, tanpa Perbarui nilai', () => {
    render(
      <DompetDetailReal
        {...props}
        data={{ ...data, account: bca, entries: [], opening: [] }}
        asset={undefined as never}
      />,
    );
    expect(screen.getByText('Saldo')).toBeTruthy();
    expect(screen.getByText('Cocokkan saldo')).toBeTruthy();
    expect(screen.queryByTestId('revalue')).toBeNull();
  });
});
