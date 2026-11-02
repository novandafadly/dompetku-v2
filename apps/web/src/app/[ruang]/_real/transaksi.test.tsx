import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EntryVM, MonthSummaryVM } from '@/features/ledger/types';
import { TransaksiFailed, TransaksiReal } from './transaksi';

vi.mock('@/features/shell/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('./transaksi-islands', () => ({
  CatatEmptyIsland: () => <button type="button">Catat</button>,
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));

const ZERO: MonthSummaryVM = { pemasukan: 0, pengeluaran: 0, selisih: 0, transfer: 0 };

function entry(id: string, over: Partial<EntryVM> = {}): EntryVM {
  return {
    id,
    version: 1,
    kind: 'expense',
    occurredOn: '2026-11-02',
    createdAt: '2026-11-02T08:00:00+07:00',
    createdBy: { id: 'u', name: 'Novanda', initial: 'N' },
    accountId: 'acc-1',
    accountName: 'BCA',
    amount: 25_000,
    categoryName: 'Makan',
    ...over,
  };
}

const base = {
  ruang: 'pribadi' as const,
  today: '2026-11-02',
  month: '2026-11',
  minMonth: '2026-10',
  query: '',
};

describe('TransaksiReal', () => {
  it('daftar per hari (server) + ringkasan bulan + tautan Sampah di bawah daftar', () => {
    render(
      <TransaksiReal
        {...base}
        data={{
          entries: [
            entry('e1', { description: 'Nasi padang' }),
            entry('e2', { occurredOn: '2026-11-01', kind: 'income', amount: 100_000 }),
          ],
          summary: { pemasukan: 100_000, pengeluaran: 25_000, selisih: 75_000, transfer: 0 },
          hasAny: true,
        }}
      />,
    );
    const today = screen.getByRole('region', { name: /^Hari ini/ });
    expect(within(today).getByRole('heading', { level: 3 })).toHaveTextContent(/Rp\s?25\.000/);
    const link = within(today).getByRole('link');
    expect(link).toHaveAttribute('href', '/pribadi/transaksi/e1');
    expect(link).toHaveTextContent('Nasi padang');
    expect(link).toHaveTextContent('Makan · BCA');
    expect(screen.getByRole('region', { name: /^Kemarin/ })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    // Filter tanpa dukungan loader tidak dirender di mode nyata.
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Filter' })).toBeNull();
    // Navigasi bulan: tautan server, bulan berikutnya mati di bulan berjalan.
    expect(screen.getByRole('link', { name: 'Bulan sebelumnya' })).toHaveAttribute(
      'href',
      '/pribadi/transaksi?bulan=2026-10',
    );
    expect(screen.getByRole('button', { name: 'Bulan berikutnya' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Sampah' })).toHaveAttribute('href', '/pribadi/sampah');
  });

  it('ringkasan dari MonthSummaryVM, tanpa anggaran', async () => {
    const { container } = render(
      <TransaksiReal
        {...base}
        data={{
          entries: [entry('e1')],
          summary: { pemasukan: 100_000, pengeluaran: 25_000, selisih: 75_000, transfer: 40_000 },
          hasAny: true,
        }}
      />,
    );
    // HP: segmen Ringkasan; laptop (lebar happy-dom bawaan): kolom ringkasan sudah tampil.
    const tab = screen.queryByRole('tab', { name: 'Ringkasan' });
    if (tab) fireEvent.click(tab);
    const table = await screen.findByRole('table', { name: 'Ringkasan bulan' });
    expect(within(table).getByRole('row', { name: /Pemasukan/ })).toHaveTextContent(/100\.000/);
    expect(within(table).getByRole('row', { name: /Selisih/ })).toHaveTextContent(/75\.000/);
    expect(container).toHaveTextContent(/Tidak termasuk: Transfer internal Rp\s?40\.000/);
    expect(screen.queryByText('Anggaran bulan ini')).toBeNull();
  });

  it('kosong pertama kali: Belum ada transaksi di {Ruang}. + Catat', () => {
    render(
      <TransaksiReal
        {...base}
        ruang="bersama"
        data={{ entries: [], summary: ZERO, hasAny: false }}
      />,
    );
    expect(screen.getByText('Belum ada transaksi di Bersama.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Catat' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Sampah' })).toHaveAttribute('href', '/bersama/sampah');
  });

  it('kosong karena bulan: salinan prototipe, tanpa Catat', () => {
    render(
      <TransaksiReal
        {...base}
        month="2026-10"
        data={{ entries: [], summary: ZERO, hasAny: true }}
      />,
    );
    expect(screen.getByText('Belum ada transaksi di Oktober.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Catat' })).toBeNull();
    // Bulan sebelumnya mati di bulan paling awal (dompet pertama dibuka).
    expect(screen.getByRole('button', { name: 'Bulan sebelumnya' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Bulan berikutnya' })).toHaveAttribute(
      'href',
      '/pribadi/transaksi',
    );
  });

  it('tautan membawa query tema', () => {
    render(
      <TransaksiReal
        {...base}
        query="?theme=light"
        data={{ entries: [entry('e1')], summary: ZERO, hasAny: true }}
      />,
    );
    expect(screen.getByRole('link', { name: /Makan/ })).toHaveAttribute(
      'href',
      '/pribadi/transaksi/e1?theme=light',
    );
    expect(screen.getByRole('link', { name: 'Sampah' })).toHaveAttribute(
      'href',
      '/pribadi/sampah?theme=light',
    );
  });
});

describe('TransaksiFailed', () => {
  it('gagal muat: salinan tetap + Coba lagi, role alert', () => {
    render(<TransaksiFailed />);
    const alert = screen.getByRole('alert');
    // Salinan tetap utuh: judul + penjelasan, dibaca berurutan.
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Transaksi belum bisa dimuat.',
    );
    expect(alert).toHaveTextContent(
      /^Transaksi belum bisa dimuat\.\s*Periksa koneksi lalu coba lagi\.\s*Coba lagi$/,
    );
    expect(within(alert).getByRole('button', { name: 'Coba lagi' })).toBeVisible();
  });
});
