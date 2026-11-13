import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DebtDetailVM,
  DebtListItemVM,
  DebtPaymentVM,
  UtangData,
} from '@/features/utang/types';
import {
  UtangDetailFailed,
  UtangDetailView,
  UtangFailed,
  UtangLoading,
  UtangPageView,
  type DetailSlots,
  type ListSlots,
} from './utang';

afterEach(cleanup);

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('elemen tidak ada');
  return v;
}

vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));
vi.mock('@/features/shell/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const SLOTS: ListSlots = {
  add: ({ variant }) => (
    <button type="button" data-variant={variant}>
      Tambah utang
    </button>
  ),
  pay: (d) => (
    <button type="button" aria-label={`Bayar ${d.contactName}`}>
      {d.direction === 'lent' ? 'Terima' : 'Bayar'}
    </button>
  ),
  restore: (d) => <button type="button">{`Pulihkan ${d.contactName}`}</button>,
};

function debt(over: Partial<DebtListItemVM> & { debtId: string }): DebtListItemVM {
  return {
    contactId: 'c',
    contactName: 'Budi',
    direction: 'borrowed',
    mode: 'baru',
    title: null,
    principal: 2_000_000,
    paid: 500_000,
    remaining: 1_500_000,
    paidPct: 25,
    settled: false,
    quick: { p25: 375_000, p50: 750_000, full: 1_500_000 },
    openedOn: '2026-10-12',
    accountId: 'a1',
    voidedAt: null,
    ...over,
  };
}

function data(debts: DebtListItemVM[], totals?: Partial<UtangData['totals']>): UtangData {
  return {
    debts,
    totals: {
      borrowed: { remaining: 0, contacts: 0 },
      lent: { remaining: 0, contacts: 0 },
      ...totals,
    },
    contacts: [],
  };
}

const view = (d: UtangData) =>
  render(<UtangPageView ruang="pribadi" query="" data={d} slots={SLOTS} />);

describe('UtangPageView (S11-UT1)', () => {
  it('segmen Anggaran | Tagihan | Utang di Pribadi dengan Utang aktif', () => {
    view(data([]));
    const nav = screen.getByRole('navigation', { name: 'Bagian Rencana' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Anggaran', 'Tagihan', 'Utang']);
    expect(within(nav).getByRole('link', { name: 'Utang' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('kosong: EmptyState dengan Tambah utang utama; tanpa kartu Sisa dan tanpa Rp 0', () => {
    view(data([]));
    expect(screen.getByRole('heading', { name: 'Belum ada utang atau piutang.' })).toBeTruthy();
    expect(screen.getByText(/supaya sisanya selalu jelas/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tambah utang' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    expect(document.body.textContent).not.toMatch(/Rp\s0\b/);
    expect(screen.queryByText('Sisa')).toBeNull();
  });

  it('kartu Sisa: tiap arah hanya bila > 0; kelompok kosong tidak dirender', () => {
    view(
      data([debt({ debtId: 'a' })], {
        borrowed: { remaining: 1_500_000, contacts: 1 },
      }),
    );
    const card = screen.getByRole('region', { name: 'Sisa' });
    expect(card).toHaveTextContent('Saya berutang');
    expect(card).toHaveTextContent(/Rp\s1\.500\.000/);
    expect(card).toHaveTextContent('1 kontak');
    expect(card).not.toHaveTextContent('Piutang');
    expect(screen.getByRole('heading', { name: 'Saya berutang' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Piutang' })).toBeNull();
  });

  it('baris: nama aksesibel dari isi terlihat, sisa, caption, tombol Bayar/Terima, urut sisa terbesar', () => {
    view(
      data(
        [
          debt({
            debtId: 'k',
            contactName: 'Kecil',
            remaining: 100_000,
            paidPct: 90,
            principal: 1_000_000,
          }),
          debt({ debtId: 'b', contactName: 'Besar', title: 'Cicilan motor' }),
          debt({ debtId: 'p', contactName: 'Piutang Pak Dani', direction: 'lent' }),
        ],
        {
          borrowed: { remaining: 1_600_000, contacts: 2 },
          lent: { remaining: 1_500_000, contacts: 1 },
        },
      ),
    );
    const groups = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(groups).toEqual(['Saya berutang', 'Piutang']);
    const links = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href')?.includes('/utang/'));
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/pribadi/rencana/utang/b',
      '/pribadi/rencana/utang/k',
      '/pribadi/rencana/utang/p',
    ]);
    const first = must(links[0]);
    expect(first).toHaveTextContent('Utang ke Besar');
    expect(first).toHaveTextContent('Cicilan motor');
    expect(first).toHaveTextContent(/Sisa\sRp\s1\.500\.000/);
    expect(first).toHaveTextContent(/25% terbayar · dari Rp\s2\.000\.000/);
    expect(links[2]).toHaveTextContent('Piutang pada Piutang Pak Dani');
    expect(screen.getAllByRole('button', { name: /^Bayar / })).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Bayar Piutang Pak Dani' })).toHaveTextContent(
      'Terima',
    );
  });

  it('lunas: grup Lunas baca-saja dengan ikon + teks, tanpa angka nol', () => {
    view(
      data([
        debt({
          debtId: 's',
          contactName: 'Selesai',
          remaining: 0,
          paid: 2_000_000,
          paidPct: 100,
          settled: true,
        }),
      ]),
    );
    const summary = screen.getByText('Lunas (1)');
    const details = summary.closest('details') as HTMLElement;
    expect(within(details).getByText('Lunas')).toBeTruthy();
    expect(details).toHaveTextContent(/Rp\s2\.000\.000/);
    expect(document.body.textContent).not.toMatch(/Rp\s0\b/);
    expect(screen.queryByRole('region', { name: 'Sisa' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tambah utang' })).toBeTruthy();
  });

  it('Utang dihapus: nama, tanggal hapus, tombol Pulihkan', () => {
    view(
      data([debt({ debtId: 'x', contactName: 'Hapus', voidedAt: '2026-11-05T10:00:00+07:00' })]),
    );
    const details = screen.getByText('Utang dihapus (1)').closest('details') as HTMLElement;
    expect(details).toHaveTextContent('Utang ke Hapus');
    expect(details).toHaveTextContent('Dihapus 5 Nov 2026');
    expect(within(details).getByRole('button', { name: 'Pulihkan Hapus' })).toBeTruthy();
  });

  it('nominal 12.345.678.900 dan nama 60 huruf tidak dihapus dari isi', () => {
    const name = 'N'.repeat(60);
    view(
      data(
        [
          debt({
            debtId: 'big',
            contactName: name,
            remaining: 12_345_678_900,
            principal: 12_345_678_900,
            paidPct: 0,
            paid: 0,
          }),
        ],
        { borrowed: { remaining: 12_345_678_900, contacts: 1 } },
      ),
    );
    expect(screen.getByRole('region', { name: 'Sisa' })).toHaveTextContent(/Rp\s12\.345\.678\.900/);
    expect(screen.getByText(name, { exact: false })).toBeTruthy();
  });

  it('tanpa merah pada angka utang', () => {
    view(data([debt({ debtId: 'a' })], { borrowed: { remaining: 1_500_000, contacts: 1 } }));
    expect(document.body.innerHTML).not.toContain('text-danger');
  });

  it('galat memuat: Segmen tetap tampil, ErrorState dengan Coba lagi', () => {
    render(<UtangFailed ruang="pribadi" query="" />);
    expect(screen.getByRole('navigation', { name: 'Bagian Rencana' })).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('Utang belum bisa dimuat.');
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  });

  it('memuat: Segmen + Memuat utang…', () => {
    render(<UtangLoading ruang="pribadi" query="" />);
    expect(screen.getByRole('status')).toHaveTextContent('Memuat utang…');
  });
});

describe('Rencana Bersama: tanpa jejak utang', () => {
  it('Segmen di Bersama hanya Anggaran dan Tagihan', () => {
    render(<UtangFailed ruang="bersama" query="" />);
    const nav = screen.getByRole('navigation', { name: 'Bagian Rencana' });
    expect(within(nav).queryByRole('link', { name: 'Utang' })).toBeNull();
  });
});

const PAY = (over: Partial<DebtPaymentVM> & { entryId: string }): DebtPaymentVM => ({
  version: 1,
  occurredOn: '2026-10-14',
  accountId: 'a1',
  accountName: 'BCA',
  amount: 375_000,
  voided: false,
  voidedAt: null,
  voidedWithDebt: false,
  createdAt: '2026-10-14T10:00:00+07:00',
  ...over,
});

function detail(over: Partial<DebtDetailVM> = {}): DebtDetailVM {
  return {
    ...debt({ debtId: 'd1' }),
    contactArchived: false,
    note: null,
    createdAt: '2026-10-12T09:00:00+07:00',
    principalEntryId: 'p1',
    accountName: 'BCA',
    payments: [],
    voidEffects: [],
    ...over,
  };
}

const DSLOTS: DetailSlots = {
  pay: <button type="button">Bayar utang</button>,
  edit: <button type="button">Ubah</button>,
  remove: <button type="button">Hapus utang</button>,
  cancel: (p) => <button type="button">{`Batalkan ${p.entryId}`}</button>,
};

const dview = (d: DebtDetailVM) =>
  render(<UtangDetailView ruang="pribadi" query="" detail={d} slots={DSLOTS} />);

describe('UtangDetailView (S11-DT1)', () => {
  it('kartu utama: h1, sub, sisa, caption; aksi berurutan; Rincian Uang baru memuat Dompet', () => {
    dview(detail({ title: 'Cicilan motor', note: 'Lewat transfer' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Utang ke Budi' })).toBeTruthy();
    expect(screen.getByText('Cicilan motor · sejak 12 Okt 2026')).toBeTruthy();
    const hero = screen.getByRole('region', { name: 'Utang ke Budi' });
    expect(hero).toHaveTextContent(/SisaRp\s1\.500\.000/);
    expect(hero).toHaveTextContent(/25% terbayar · Rp\s500\.000 dari Rp\s2\.000\.000/);
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Bayar utang', 'Ubah', 'Hapus utang']);
    const dl = screen.getByRole('region', { name: 'Rincian' });
    expect(dl).toHaveTextContent('Saya berutang');
    expect(dl).toHaveTextContent('Uang baru');
    expect(dl).toHaveTextContent('BCA');
    expect(dl).toHaveTextContent('Lewat transfer');
  });

  it('lunas: Lunas menggantikan angka, tanpa aksi Bayar, tanpa Rp 0', () => {
    dview(detail({ remaining: 0, paid: 2_000_000, paidPct: 100, settled: true }));
    const hero = screen.getByRole('region', { name: 'Utang ke Budi' });
    expect(hero).toHaveTextContent('Lunas');
    expect(hero).toHaveTextContent(/Rp\s2\.000\.000 terbayar penuh/);
    expect(screen.queryByRole('button', { name: 'Bayar utang' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Rp\s0\b/);
  });

  it('berjalan: catatan saldo tidak ikut berubah dan tanpa baris Dompet', () => {
    dview(detail({ mode: 'berjalan', accountId: null, accountName: null, principalEntryId: null }));
    const dl = screen.getByRole('region', { name: 'Rincian' });
    expect(dl).toHaveTextContent('Sudah berjalan');
    expect(dl).toHaveTextContent('Saldo dompet tidak ikut berubah.');
    expect(within(dl).queryByText('Dompet')).toBeNull();
  });

  it('Piutang: judul dan kata Terima', () => {
    dview(detail({ direction: 'lent', payments: [PAY({ entryId: 'e1' })] }));
    expect(screen.getByRole('heading', { level: 1, name: 'Piutang pada Budi' })).toBeTruthy();
    expect(screen.getByText('Diterima di BCA')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Pembayaran dari Budi' })).toBeTruthy();
  });

  it('riwayat: terbaru dulu, dibatalkan tetap tampil redup bertanda Dibatalkan (bukan tombol), baris terakhir statis', () => {
    dview(
      detail({
        payments: [
          PAY({ entryId: 'old', occurredOn: '2026-10-14' }),
          PAY({ entryId: 'new', occurredOn: '2026-11-02', amount: 100_000 }),
          PAY({ entryId: 'void', occurredOn: '2026-10-20', voided: true }),
        ],
      }),
    );
    const list = screen.getByRole('list', { name: 'Pembayaran utang ke Budi' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('2 Nov 2026'),
      expect.stringContaining('20 Okt 2026'),
      expect.stringContaining('14 Okt 2026'),
    ]);
    expect(rows[1]).toHaveTextContent('Dibatalkan');
    expect(within(must(rows[1])).queryByRole('button')).toBeNull();
    expect(within(must(rows[0])).getByRole('button', { name: 'Batalkan new' })).toBeTruthy();
    expect(within(must(rows[0])).getByRole('link')).toHaveAttribute(
      'href',
      '/pribadi/transaksi/new',
    );
    expect(screen.getByText('Utang dicatat 12 Okt 2026')).toBeTruthy();
  });

  it('tanpa pembayaran: Belum ada pembayaran.', () => {
    dview(detail());
    expect(screen.getByText('Belum ada pembayaran.')).toBeTruthy();
  });

  it('BackLink ke daftar Utang, tanpa merah selain tombol destruktif (slot)', () => {
    dview(detail());
    expect(screen.getByRole('link', { name: 'Utang' })).toHaveAttribute(
      'href',
      '/pribadi/rencana?bagian=utang',
    );
    expect(document.body.innerHTML).not.toContain('text-danger');
  });

  it('galat memuat detail: ErrorState + BackLink', () => {
    render(<UtangDetailFailed ruang="pribadi" query="?theme=light" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Utang belum bisa dimuat.');
    expect(screen.getByRole('link', { name: 'Utang' })).toHaveAttribute(
      'href',
      '/pribadi/rencana?theme=light&bagian=utang',
    );
  });
});
