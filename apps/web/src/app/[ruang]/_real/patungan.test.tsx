import { cleanup, render, screen, within } from '@testing-library/react';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  PatunganData,
  SplitBalanceVM,
  SplitHistoryItemVM,
} from '@/features/ledger/patungan-types';
import { PatunganFailed, PatunganLoading, PatunganReal } from './patungan';

afterEach(cleanup);

vi.mock('./patungan-islands', () => ({
  PatunganHostIsland: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettleIsland: ({ label }: { label: string }) => <button type="button">{label}</button>,
  ReceiveIsland: ({ label, settlementId }: { label: string; settlementId: string }) => (
    <button type="button" data-receive={settlementId} aria-label={label}>
      Terima
    </button>
  ),
  RowActionIsland: ({
    kind,
    label,
    ariaLabel,
  }: {
    kind: string;
    label: string;
    ariaLabel: string;
  }) => (
    <button type="button" data-kind={kind} aria-label={ariaLabel}>
      {label}
    </button>
  ),
  RestoreSplitIsland: ({ ariaLabel }: { ariaLabel: string }) => (
    <button type="button" aria-label={ariaLabel}>
      Pulihkan
    </button>
  ),
  CatatIsland: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));

const N = { id: 'n', name: 'Novanda', initial: 'N' };
const F = { id: 'f', name: 'Farida', initial: 'F' };

const balance = (over: Partial<SplitBalanceVM> = {}): SplitBalanceVM => ({
  me: N,
  partner: F,
  debtorId: 'f',
  creditorId: 'n',
  amount: 200_000,
  splitCount: 1,
  settlementCount: 0,
  pending: [],
  ...over,
});

const bill = (over: Partial<Extract<SplitHistoryItemVM, { item: 'split' }>> = {}) =>
  ({
    item: 'split',
    id: 's1',
    occurredOn: '2026-11-12',
    createdAt: '2026-11-12T10:00:00+07:00',
    amount: 400_000,
    voidedAt: null,
    purgeAfter: null,
    payerId: 'n',
    description: 'Listrik',
    categoryName: 'Listrik & Air',
    categoryIcon: 'Lightning',
    expenseEntryId: 'e1',
    shares: [
      { userId: 'f', amount: 200_000 },
      { userId: 'n', amount: 200_000 },
    ],
    ...over,
  }) as SplitHistoryItemVM;

const settlement = (over: Partial<Extract<SplitHistoryItemVM, { item: 'settlement' }>> = {}) =>
  ({
    item: 'settlement',
    id: 't1',
    occurredOn: '2026-11-14',
    createdAt: '2026-11-14T10:00:00+07:00',
    amount: 100_000,
    voidedAt: null,
    purgeAfter: null,
    fromId: 'f',
    toId: 'n',
    received: false,
    ...over,
  }) as SplitHistoryItemVM;

function view(data: Partial<PatunganData>, extra: { newest?: boolean; older?: boolean } = {}) {
  return render(
    <PatunganReal
      data={{ balance: balance(), history: [], deleted: [], next: null, ...data }}
      query=""
      today="2026-11-14"
      backHref={'/bersama/beranda' as Route}
      olderHref={extra.older === true ? ('/bersama/patungan?sebelum=x' as Route) : null}
      newestHref={extra.newest === true ? ('/bersama/patungan' as Route) : null}
      initial={{ lunasi: false, terima: null }}
    />,
  );
}

describe('PatunganReal (S12-PT2)', () => {
  it('pemberi piutang: kalimat besar dari SQL, tanpa Lunasi; baris tagihan dengan Hapus, tanpa nama dompet', () => {
    const { container } = view({ history: [bill()] });
    expect(screen.getByRole('heading', { name: 'Patungan · Bersama', level: 1 })).toBeTruthy();
    const hero = screen.getByRole('region', { name: 'Saldo patungan' });
    expect(hero).toHaveTextContent('Farida berutang Rp 200.000 ke kamu');
    expect(within(hero).queryByRole('button', { name: /Lunasi/ })).toBeNull();
    const row = screen.getByRole('link', { name: /Listrik/ });
    expect(row.getAttribute('href')).toBe('/bersama/transaksi/e1');
    expect(row).toHaveTextContent('Dibayar kamu · bagian Farida Rp 200.000 · 12 Nov');
    expect(row).toHaveTextContent('Rp 400.000');
    expect(screen.getByRole('button', { name: 'Hapus tagihan patungan Listrik' })).toBeTruthy();
    expect(container.textContent).not.toMatch(/dompet pribadi|BCA/i);
    expect(container.innerHTML).not.toMatch(/text-(danger|income|expense)/);
  });

  it('pengutang: tombol Lunasi Rp …; tagihan orang lain tanpa Hapus', () => {
    view({
      balance: balance({ debtorId: 'n', creditorId: 'f' }),
      history: [bill({ payerId: 'f' })],
    });
    expect(screen.getByRole('button', { name: /^Lunasi Rp\s200\.000$/ })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Saldo patungan' })).toHaveTextContent(
      'Kamu berutang Rp 200.000 ke Farida',
    );
    expect(screen.queryByRole('button', { name: /^Hapus/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Listrik/ })).toHaveTextContent(
      'Dibayar Farida · bagian kamu Rp 200.000',
    );
  });

  it('impas: ikon + teks, tanpa nominal dan tanpa tombol Lunasi', () => {
    view({
      balance: balance({ debtorId: null, creditorId: null, amount: null }),
      history: [bill()],
    });
    const hero = screen.getByRole('region', { name: 'Saldo patungan' });
    expect(hero).toHaveTextContent('Patungan impas');
    expect(hero.textContent).not.toMatch(/Rp/);
  });

  it('Menunggu diterima: penerima dapat Terima, pelunas melihat status menunggu', () => {
    view({
      balance: balance({
        pending: [{ id: 't1', fromId: 'f', toId: 'n', amount: 100_000, occurredOn: '2026-11-14' }],
      }),
      history: [settlement()],
    });
    const waiting = screen.getByRole('region', { name: 'Menunggu diterima' });
    expect(waiting).toHaveTextContent('Farida melunasi Rp 100.000');
    expect(
      within(waiting).getByRole('button', { name: 'Terima pelunasan dari Farida' }),
    ).toBeTruthy();
    cleanup();
    view({
      balance: balance({
        pending: [{ id: 't1', fromId: 'n', toId: 'f', amount: 100_000, occurredOn: '2026-11-14' }],
      }),
      history: [settlement({ fromId: 'n', toId: 'f' })],
    });
    expect(screen.getByRole('region', { name: 'Menunggu diterima' })).toHaveTextContent(
      'Menunggu Farida',
    );
    expect(screen.getByRole('button', { name: /^Batalkan pelunasan 14 Nov/ })).toBeTruthy();
  });

  it('pelunasan sudah diterima: pelunas tanpa Batalkan, dengan penjelasan; penerima dapat Batalkan penerimaan', () => {
    view({ history: [settlement({ fromId: 'n', toId: 'f', received: true })] });
    expect(
      screen.getByText('Sudah diterima Farida. Minta Farida membatalkan penerimaannya dulu.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Batalkan/ })).toBeNull();
    cleanup();
    view({ history: [settlement({ received: true })] });
    expect(screen.getByRole('button', { name: 'Batalkan penerimaan dari Farida' })).toBeTruthy();
    expect(screen.getByText('Diterima')).toBeTruthy();
  });

  it('Patungan dihapus: grup dengan Pulihkan; pelunasan batal bertanda Dibatalkan tanpa aksi', () => {
    view({
      deleted: [
        bill({ id: 's9', voidedAt: '2026-11-13T10:00:00+07:00', purgeAfter: '2027-02-11' }),
        settlement({ id: 't9', voidedAt: '2026-11-13T10:00:00+07:00', purgeAfter: '2027-02-11' }),
      ],
      history: [bill()],
    });
    const group = screen.getByText('Patungan dihapus (2)').closest('details');
    expect(group).toBeTruthy();
    expect(within(group as HTMLElement).getByText('Dibatalkan')).toBeTruthy();
    expect(
      within(group as HTMLElement).getByRole('button', {
        name: 'Pulihkan tagihan patungan Listrik',
      }),
    ).toBeTruthy();
  });

  it('kosong: keadaan kosong dengan aksi Catat; tanpa Rp 0', () => {
    const { container } = view({ balance: balance({ debtorId: null, amount: null }) });
    expect(screen.getByText('Belum ada tagihan patungan.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Catat pengeluaran Bersama' })).toBeTruthy();
    expect(container.textContent).not.toMatch(/Rp\s0(?!\d|\.)/);
  });

  it('solo: butuh dua anggota, ajakan undang', () => {
    view({ balance: null });
    expect(screen.getByText('Patungan butuh dua anggota.')).toBeTruthy();
    expect(screen.getByText('Ajak Farida ke Bersama dulu.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Undang Farida' }).getAttribute('href')).toBe(
      '/undang',
    );
  });

  it('paginasi: Muat lagi dan Kembali ke terbaru adalah tautan', () => {
    view({ history: [bill()] }, { older: true, newest: true });
    expect(screen.getByRole('link', { name: 'Muat lagi' }).getAttribute('href')).toBe(
      '/bersama/patungan?sebelum=x',
    );
    expect(screen.getByRole('link', { name: 'Kembali ke terbaru' })).toBeTruthy();
  });

  it('galat dan memuat memakai salinan bingkai', () => {
    render(<PatunganFailed backHref={'/bersama/beranda' as Route} />);
    expect(screen.getByText('Patungan belum bisa dimuat.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
    cleanup();
    render(<PatunganLoading />);
    expect(screen.getByText('Memuat patungan…')).toBeTruthy();
  });
});
