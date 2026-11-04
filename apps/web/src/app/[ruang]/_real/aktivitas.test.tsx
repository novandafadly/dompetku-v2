import type { Route } from 'next';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityItemVM } from '@/features/bersama/types';
import { AktivitasFailed, AktivitasReal } from './aktivitas';

vi.mock('@/features/shell/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

afterEach(cleanup);

const F = { id: 'u-f', name: 'Farida', initial: 'F', role: 'member' as const };
const N = { id: 'u-n', name: 'Novanda', initial: 'N', role: 'owner' as const };

const item = (n: number, over: Partial<ActivityItemVM> = {}): ActivityItemVM => ({
  key: `e${String(n)}:1`,
  entryId: `e${String(n)}`,
  actor: F,
  at: '2026-11-04T09:15:00+07:00',
  text: 'mencatat pengeluaran Makan',
  change: [],
  backdate: null,
  amount: 25_000,
  beforeAmount: null,
  moved: false,
  href: `/bersama/transaksi/e${String(n)}` as Route,
  ...over,
});

const base = {
  today: '2026-11-04',
  query: '',
  backHref: '/bersama/beranda' as Route,
  newestHref: null,
  olderHref: null,
  partnerName: 'Farida',
};

describe('AktivitasReal (S8-A3)', () => {
  it('kelompok per hari WIB peristiwa, baris menaut ke Detail, waktu HH.mm saja', () => {
    render(
      <AktivitasReal
        {...base}
        items={[
          item(1),
          item(2, { actor: N, at: '2026-11-04T08:00:00+07:00' }),
          // 23.30 WIB 3 Nov: bukan hari occurred_on, bukan UTC.
          item(3, { at: '2026-11-03T23:30:00+07:00', backdate: 'tanggal 26 Okt' }),
        ]}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Daftar aktivitas' })).toHaveClass(
      'sr-only',
    );
    const hariIni = screen.getByRole('region', { name: 'Hari ini' });
    expect(within(hariIni).getAllByRole('listitem')).toHaveLength(2);
    expect(within(hariIni).getByRole('heading', { level: 3 })).toHaveTextContent('Hari ini');
    const kemarin = screen.getByRole('region', { name: 'Kemarin' });
    const link = within(kemarin).getByRole('link');
    expect(link).toHaveAttribute('href', '/bersama/transaksi/e3');
    expect(link.textContent).toContain('23.30 · tanggal 26 Okt');
    expect(link.textContent).not.toContain('Kemarin ·');
    expect(within(hariIni).getAllByRole('link')[0]?.textContent).toContain('09.15');
    expect(within(hariIni).getAllByRole('link')[0]?.textContent).not.toContain('Hari ini ·');
  });

  it('query terbawa ke tautan baris, Beranda, Muat sebelumnya; tanpa id di markup selain href', () => {
    const { container } = render(
      <AktivitasReal
        {...base}
        query="?theme=light"
        olderHref={'/bersama/aktivitas?theme=light&sebelum=abc_-1' as Route}
        items={[item(1)]}
      />,
    );
    expect(screen.getByRole('link', { name: /Farida/ })).toHaveAttribute(
      'href',
      '/bersama/transaksi/e1?theme=light',
    );
    expect(screen.getByRole('link', { name: /Beranda/ })).toHaveAttribute(
      'href',
      '/bersama/beranda',
    );
    const more = screen.getByRole('link', { name: 'Muat sebelumnya' });
    expect(more).toHaveAttribute('href', '/bersama/aktivitas?theme=light&sebelum=abc_-1');
    expect(more.className).toContain('min-h-12');
    // Id baris hanya boleh muncul di href.
    const html = container.innerHTML.replaceAll(/href="[^"]*"/g, '');
    expect(html).not.toContain('e1:1');
    expect(html).not.toMatch(/\be1\b/);
  });

  it('halaman berkursor: Kembali ke terbaru di atas daftar; tanpa Muat sebelumnya bila habis', () => {
    render(
      <AktivitasReal
        {...base}
        newestHref={'/bersama/aktivitas?theme=light' as Route}
        items={[item(1)]}
      />,
    );
    const back = screen.getByRole('link', { name: 'Kembali ke terbaru' });
    expect(back).toHaveAttribute('href', '/bersama/aktivitas?theme=light');
    expect(screen.queryByRole('link', { name: 'Muat sebelumnya' })).toBeNull();
    // Urutan DOM: tautan di atas daftar.
    const list = screen.getByRole('heading', { level: 2, name: 'Daftar aktivitas' });
    expect(back.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('kosong dua anggota: EmptyState dengan nama anggota lain, tanpa Muat sebelumnya', () => {
    render(<AktivitasReal {...base} items={[]} />);
    expect(screen.getByText('Belum ada aktivitas.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Yang kamu dan Farida catat di Bersama akan muncul di sini, terbaru di atas.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Muat sebelumnya' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Daftar aktivitas' })).toBeNull();
  });

  it('items kosong tetapi ada kursor lanjut: keadaan kosong, tidak ada tautan Muat sebelumnya', () => {
    render(
      <AktivitasReal
        {...base}
        items={[]}
        olderHref={'/bersama/aktivitas?sebelum=x' as Route}
        newestHref={'/bersama/aktivitas' as Route}
      />,
    );
    expect(screen.getByText('Belum ada aktivitas.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Muat sebelumnya' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Kembali ke terbaru' })).toBeInTheDocument();
  });

  it('solo: salinan tanpa nama', () => {
    render(<AktivitasReal {...base} partnerName={null} items={[]} />);
    expect(
      screen.getByText('Yang dicatat di Bersama akan muncul di sini, terbaru di atas.'),
    ).toBeInTheDocument();
  });

  it('tidak pernah menulis "rumah tangga" dan nama dompet tidak ada', () => {
    const { container } = render(<AktivitasReal {...base} items={[item(1)]} />);
    expect(container.textContent).not.toMatch(/rumah tangga/i);
  });
});

describe('AktivitasFailed', () => {
  it('ErrorState + Coba lagi sebagai tautan biasa ke URL yang sama', () => {
    render(
      <AktivitasFailed
        backHref={'/bersama/beranda' as Route}
        retryHref="/bersama/aktivitas?sebelum=x"
      />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Aktivitas belum bisa dimuat.')).toBeInTheDocument();
    expect(screen.getByText('Periksa koneksi lalu coba lagi.')).toBeInTheDocument();
    const retry = screen.getByRole('link', { name: 'Coba lagi' });
    expect(retry.tagName).toBe('A');
    expect(retry).toHaveAttribute('href', '/bersama/aktivitas?sebelum=x');
    expect(retry.className).toContain('min-h-12');
  });
});
