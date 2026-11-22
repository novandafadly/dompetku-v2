import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountVM } from '@/features/ledger/types';
import type { StockHoldingVM, StockOverviewVM, StockTotalVM } from '@/features/saham/types';
import { StockActions, StockBalance, StockSection, stockScope } from './dompet-saham';

afterEach(cleanup);

vi.mock('./saham-islands', () => ({
  StockButtonIsland: ({
    kind,
    label,
    ticker,
    ariaLabel,
  }: {
    kind: string;
    label: string;
    ticker?: string;
    ariaLabel?: string;
  }) => (
    <button type="button" data-kind={kind} data-ticker={ticker ?? ''} aria-label={ariaLabel}>
      {label}
    </button>
  ),
  VoidTradeIsland: ({ ticker }: { ticker: string }) => (
    <button type="button" aria-label={`Batalkan transaksi ${ticker} terakhir`}>
      Batalkan
    </button>
  ),
}));

const holding = (over: Partial<StockHoldingVM> = {}): StockHoldingVM => ({
  holdingId: 'h1',
  ticker: 'BBCA',
  shares: 300,
  costTotal: 2_761_000,
  avgCost: 9203,
  close: 9_800,
  closeOn: '2026-11-14',
  stale: false,
  heldPending: false,
  heldOn: null,
  marketValue: 2_940_000,
  unrealized: 179_000,
  realized: 0,
  lastTradeId: 't2',
  trades: [
    {
      id: 't2',
      side: 'buy',
      shares: 100,
      price: 9300,
      occurredOn: '2026-11-12',
      counterName: 'RDN Ajaib',
    },
    {
      id: 't1',
      side: 'buy',
      shares: 200,
      price: 9150,
      occurredOn: '2026-11-10',
      counterName: 'RDN Ajaib',
    },
  ],
  ...over,
});

const total = (over: Partial<StockTotalVM> = {}): StockTotalVM => ({
  costTotal: 2_761_000,
  marketValue: 2_940_000,
  unrealized: 179_000,
  realized: 0,
  stale: false,
  heldPending: false,
  missingPriceCount: 0,
  ...over,
});

const ov = (holdings: StockHoldingVM[], t: Partial<StockTotalVM> = {}): StockOverviewVM => ({
  holdings,
  total: total(t),
});

const acc = (id: string, name: string, pocket: AccountVM['pocket']): AccountVM => ({
  id,
  name,
  pocket,
  walletType: 'bank',
  openedOn: '2026-11-01',
  archived: false,
  balance: 1_000_000,
});

const scopeOf = (overview: StockOverviewVM) =>
  stockScope({
    ruang: 'pribadi',
    today: '2026-11-16',
    account: { id: 'saham1', name: 'Ajaib', openedOn: '2026-11-01' },
    accounts: [acc('bca', 'BCA', 'operasional'), acc('rdn', 'RDN Ajaib', 'trading')],
    overview,
  });

describe('StockBalance (S14-SH1)', () => {
  it('nilai pasar besar, biaya beli, untung belum terealisasi dengan kata, label harga tanggal terlama', () => {
    const o = ov([holding(), holding({ holdingId: 'h2', ticker: 'TLKM', closeOn: '2026-11-12' })]);
    const { container } = render(<StockBalance overview={o} />);
    expect(container).toHaveTextContent(/2\.940\.000/);
    expect(container).toHaveTextContent(/Biaya beli\s+Rp\s*2\.761\.000/);
    expect(container).toHaveTextContent(/Belum terealisasi\s*\+Rp\s*179\.000 untung/);
    expect(container).not.toHaveTextContent('Sudah terealisasi');
    expect(container).toHaveTextContent('Harga 12 Nov');
    expect(container.innerHTML).not.toMatch(/text-income|text-danger/);
  });

  it('terealisasi ≠ 0 ditampilkan; impas = kata; rugi memakai minus U+2212', () => {
    const { container, rerender } = render(
      <StockBalance overview={ov([holding()], { realized: -40_667, unrealized: 0 })} />,
    );
    expect(container).toHaveTextContent('Belum terealisasi impas');
    expect(container).toHaveTextContent(/Sudah terealisasi\s*−Rp\s*40\.667 rugi/);
    rerender(<StockBalance overview={ov([holding()], { unrealized: -60_000 })} />);
    expect(container).toHaveTextContent(/−Rp\s*60\.000 rugi/);
  });

  it('sebagian tanpa harga: label jujur dan tanpa Impas; keadaan harga lama dan perlu dicek di kartu', () => {
    const { container, rerender } = render(
      <StockBalance
        overview={ov([holding({ close: null, closeOn: null })], {
          missingPriceCount: 1,
          unrealized: null,
        })}
      />,
    );
    expect(container).toHaveTextContent(
      'Sebagian saham belum ada harga, dinilai sebesar biaya beli.',
    );
    expect(container).not.toHaveTextContent('Belum terealisasi');
    rerender(<StockBalance overview={ov([holding()], { stale: true })} />);
    expect(container).toHaveTextContent('Ada harga lama.');
    rerender(<StockBalance overview={ov([holding()], { heldPending: true, stale: true })} />);
    expect(container).toHaveTextContent('Ada harga yang perlu dicek.');
    expect(container).not.toHaveTextContent('Ada harga lama.');
  });

  it('tanpa saham: Belum ada saham, tanpa Rp 0', () => {
    const { container } = render(
      <StockBalance overview={ov([holding({ shares: 0, marketValue: 0, costTotal: 0 })])} />,
    );
    expect(container).toHaveTextContent('Belum ada saham');
    expect(container).not.toHaveTextContent('Rp');
  });
});

describe('StockActions', () => {
  it('Beli saham selalu; Jual dan Isi harga hanya bila ada saham; tautan Saham yang sudah dimiliki', () => {
    const { rerender } = render(<StockActions scope={scopeOf(ov([holding()]))} />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('data-kind'))).toEqual([
      'buy',
      'sell',
      'price',
      'open',
    ]);
    expect(
      screen.getByText('Biaya broker masuk ke biaya beli. Untung atau rugi tidak masuk Laporan.'),
    ).toBeTruthy();
    rerender(<StockActions scope={scopeOf(ov([]))} />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('data-kind'))).toEqual([
      'buy',
      'open',
    ]);
  });

  it('lingkup pulau: dompet kas hanya operasional/tabungan/trading (trading dulu), kode yang dipegang saja', () => {
    const s = scopeOf(ov([holding(), holding({ holdingId: 'h2', ticker: 'GOTO', shares: 0 })]));
    expect(s.cash.map((c) => c.id)).toEqual(['rdn', 'bca']);
    expect(s.holdings.map((h) => h.ticker)).toEqual(['BBCA']);
    // Kode yang sudah dijual habis tetap membatasi tanggal transaksi baru (DB: before_latest_entry).
    expect(s.lastTradeOn).toEqual({ BBCA: '2026-11-12', GOTO: '2026-11-12' });
  });
});

describe('StockSection (S14-SH1/SH2)', () => {
  const render1 = (o: StockOverviewVM) => render(<StockSection scope={scopeOf(o)} overview={o} />);

  it('baris saham: kode, lembar · lot, nilai pasar, untung dengan kata, rata-rata dan Harga · tanggal', () => {
    render1(ov([holding()]));
    const row = screen.getByTestId('holding-BBCA');
    expect(row).toHaveTextContent('BBCA');
    expect(row).toHaveTextContent(/300 lembar\s?· 3 lot/);
    expect(row).toHaveTextContent(/Rata-rata Rp\s*9\.203/);
    expect(row).toHaveTextContent(/Harga Rp\s*9\.800 · 14 Nov/);
    expect(row).toHaveTextContent(/\+Rp\s*179\.000 untung/);
    expect(row.innerHTML).not.toMatch(/text-income|text-danger/);
    expect(row.textContent).not.toMatch(/Harga lama|Belum ada harga|Harga perlu dicek/);
  });

  it('odd lot tanpa pecahan lot', () => {
    render1(ov([holding({ shares: 250 })]));
    expect(screen.getByTestId('holding-BBCA')).toHaveTextContent('250 lembar');
    expect(screen.getByTestId('holding-BBCA').textContent).not.toMatch(/250 lembar · /);
  });

  it('keadaan harga: Harga lama (jam), Belum ada harga (info, tanpa untung/Impas), Harga perlu dicek (peringatan, harga lama dipakai)', () => {
    render1(
      ov([
        holding({ ticker: 'LAMA', holdingId: 'a', stale: true, closeOn: '2026-11-07' }),
        holding({
          ticker: 'NOPE',
          holdingId: 'b',
          close: null,
          closeOn: null,
          unrealized: null,
          marketValue: 1_000_000,
          costTotal: 1_000_000,
        }),
        holding({
          ticker: 'TAHAN',
          holdingId: 'c',
          heldPending: true,
          heldOn: '2026-11-15',
          closeOn: '2026-11-12',
        }),
      ]),
    );
    const lama = screen.getByTestId('holding-LAMA');
    expect(lama).toHaveTextContent('Harga lama');
    expect(lama).toHaveTextContent('Isi harga terbaru.');
    expect(lama).toHaveTextContent(/Harga Rp\s*9\.800 · 7 Nov/);
    const nope = screen.getByTestId('holding-NOPE');
    expect(nope).toHaveTextContent('Belum ada harga');
    expect(nope).toHaveTextContent('sebesar biaya beli');
    expect(nope).not.toHaveTextContent('Impas');
    expect(nope).not.toHaveTextContent('untung');
    const tahan = screen.getByTestId('holding-TAHAN');
    expect(tahan).toHaveTextContent('Harga perlu dicek');
    expect(tahan).toHaveTextContent(
      'Harga 15 Nov ditahan karena berubah lebih dari 35%. Yang dipakai masih harga 12 Nov.',
    );
    expect(tahan.querySelector('.text-warning')).not.toBeNull();
  });

  it('isi terbuka: dl biaya beli, harga rata-rata, harga terakhir, nilai pasar, belum terealisasi; Impas bukan Rp 0', () => {
    render1(ov([holding({ unrealized: 0, realized: -40_667 })]));
    const row = screen.getByTestId('holding-BBCA');
    const dl = within(row)
      .getAllByRole('term')
      .map((t) => t.textContent);
    expect(dl).toEqual([
      'Biaya beli',
      'Harga rata-rata',
      'Harga terakhir',
      'Nilai pasar',
      'Belum terealisasi',
      'Sudah terealisasi',
    ]);
    expect(row).toHaveTextContent('Impas');
    expect(row).toHaveTextContent(/−Rp\s*40\.667 rugi/);
  });

  it('aksi per baris membawa kode terkunci dengan nama aksesibel; Batalkan hanya pada transaksi terakhir', () => {
    render1(ov([holding()]));
    const row = screen.getByTestId('holding-BBCA');
    for (const name of ['Beli lagi BBCA', 'Jual BBCA', 'Isi harga BBCA']) {
      expect(within(row).getByRole('button', { name })).toHaveAttribute('data-ticker', 'BBCA');
    }
    expect(
      within(row).getAllByRole('button', { name: /Batalkan transaksi BBCA terakhir/ }),
    ).toHaveLength(1);
    expect(row).toHaveTextContent('Transaksi BBCA');
    expect(row).toHaveTextContent(/Beli 1 lot @ Rp\s*9\.300/);
    expect(row).toHaveTextContent(/Beli 2 lot @ Rp\s*9\.150/);
    expect(row).toHaveTextContent('Hanya transaksi terakhir yang bisa dibatalkan.');
  });

  it('sudah dijual habis: lipatan dengan jumlah, terealisasi dengan kata, tanpa harga; daftar utama tanpa kode itu', () => {
    render1(
      ov([
        holding(),
        holding({ ticker: 'GOTO', holdingId: 'g', shares: 0, realized: 16_000, marketValue: 0 }),
      ]),
    );
    expect(screen.getByText('Sudah dijual habis (1)')).toBeTruthy();
    expect(screen.queryByTestId('holding-GOTO')).toBeNull();
    expect(screen.getByText('GOTO')).toBeTruthy();
    expect(document.body).toHaveTextContent(/\+Rp\s*16\.000 untung/);
  });

  it('sudah dijual habis: transaksi terakhir tampil dengan Batalkan (P2), supaya penjualan terakhir bisa dibatalkan', () => {
    render1(
      ov([
        holding({
          ticker: 'GOTO',
          holdingId: 'g',
          shares: 0,
          realized: 16_000,
          marketValue: 0,
          lastTradeId: 'g2',
          trades: [
            {
              id: 'g2',
              side: 'sell',
              shares: 100,
              price: 80,
              occurredOn: '2026-11-14',
              counterName: 'BCA',
            },
            {
              id: 'g1',
              side: 'buy',
              shares: 100,
              price: 64,
              occurredOn: '2026-11-10',
              counterName: 'BCA',
            },
          ],
        }),
      ]),
    );
    const list = screen.getByText('Sudah dijual habis (1)').closest('details');
    if (list === null) throw new Error('lipatan tidak ada');
    expect(list).toHaveTextContent(/14 Nov · Jual 1 lot @ Rp\s*80/);
    expect(list).not.toHaveTextContent(/Beli 1 lot/);
    expect(
      within(list).getAllByRole('button', { name: /Batalkan transaksi GOTO terakhir/ }),
    ).toHaveLength(1);
  });

  it('kosong: ajakan Beli saham + Saham yang sudah dimiliki; tanpa saham tetapi ada riwayat jual = lipatan', () => {
    render1(ov([]));
    expect(screen.getByText('Belum ada saham di Ajaib.')).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('data-kind'))).toEqual([
      'buy',
      'open',
    ]);
  });
});
