import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BerandaData } from '@/server/ledger/beranda';
import { BerandaReal } from './beranda';

afterEach(cleanup);

vi.mock('./beranda-islands', () => ({
  NoSpendIsland: () => <button type="button">Tanpa pengeluaran hari ini</button>,
  CatatStepIsland: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
vi.mock('../_actions/beranda', () => ({ markNoSpendDayAction: vi.fn() }));
vi.mock('@/features/shell/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => (
    <header>
      <h1>{title}</h1>
    </header>
  ),
}));

const base: BerandaData = {
  safe: { operasional: 1_000_000, billsUntilEom: 0, budgetWajibRemaining: 0, aman: 1_000_000 },
  today: { hasExpense: false, noSpendMarked: false },
  hasOperasional: true,
  hasExpense: false,
  recent: [],
  invite: false,
  bersama: null,
};

function view(over: Partial<BerandaData>, ruang: 'pribadi' | 'bersama' = 'bersama'): ReactNode {
  return <BerandaReal ruang={ruang} today="2026-11-04" query="" data={{ ...base, ...over }} />;
}

const INTRO = /Sekarang hanya kamu di sini; Farida belum bergabung\./;
const AKTIVITAS = /Belum ada aktivitas\. Yang dicatat di Bersama akan muncul di sini/;

describe('BerandaReal Bersama solo (S7-B1)', () => {
  it('pemilik, belum ada undangan: kartu ajakan, pengantar checklist, Aktivitas kosong', () => {
    render(view({ bersama: { members: 1, isOwner: true, empty: false, pendingInvite: null } }));
    const ajakan = screen.getByRole('region', { name: 'Farida belum bergabung di Bersama.' });
    const link = within(ajakan).getByRole('link', { name: 'Undang Farida ke Bersama' });
    expect(link.getAttribute('href')).toBe('/undang');
    expect(link.textContent).toBe('Undang Farida');
    expect(screen.getByText(INTRO)).toBeTruthy();
    expect(screen.queryByText(/kamu dan Farida sama-sama/i)).toBeNull();
    expect(screen.getByRole('region', { name: 'Aktivitas' })).toBeTruthy();
    expect(screen.getByText(AKTIVITAS)).toBeTruthy();
    // Tanpa avatar/inisial anggota kedua.
    expect(screen.queryByText(/^F$/)).toBeNull();
  });

  it('pemilik, undangan menunggu: email dan tanggal, tombol Kelola undangan', () => {
    render(
      view({
        bersama: {
          members: 1,
          isOwner: true,
          empty: false,
          pendingInvite: { email: 'farida@example.test', expiresOn: '2026-11-07' },
        },
      }),
    );
    expect(
      screen.getByText('Undangan untuk farida@example.test menunggu, berlaku sampai Sab, 7 Nov.'),
    ).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Kelola undangan' });
    expect(link.getAttribute('href')).toBe('/undang');
    expect(screen.queryByRole('link', { name: /Undang Farida ke Bersama/ })).toBeNull();
  });

  it('bukan pemilik: tanpa kartu ajakan dan tanpa email', () => {
    const { container } = render(view({ bersama: { members: 1, isOwner: false, empty: false } }));
    expect(screen.queryByText('Farida belum bergabung di Bersama.')).toBeNull();
    expect(screen.queryByRole('link', { name: /Undang|Kelola undangan/ })).toBeNull();
    expect(screen.getByText(INTRO)).toBeTruthy();
    expect(container.textContent).not.toContain('@');
  });
});

describe('BerandaReal Bersama kosong (S7-B2)', () => {
  const kosong = {
    hasOperasional: false,
    safe: { operasional: 0, billsUntilEom: 0, budgetWajibRemaining: 0, aman: 0 },
  };

  it('State kosong menggantikan Aman; tanpa Tanpa pengeluaran dan Terbaru', () => {
    render(view({ ...kosong, bersama: { members: 2, isOwner: true, empty: true } }));
    expect(screen.getByRole('heading', { name: 'Bersama belum punya dompet.' })).toBeTruthy();
    expect(
      screen.getByText('Buat dompet bersama dulu, lalu catat pengeluaran rumah tangga di sini.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tambah dompet' }).getAttribute('href')).toBe(
      '/bersama/dompet?tambah=1',
    );
    expect(screen.queryByTestId('balance-card')).toBeNull();
    expect(screen.queryByRole('button', { name: /Tanpa pengeluaran/ })).toBeNull();
    expect(screen.queryByRole('region', { name: /Terbaru|Terakhir/ })).toBeNull();
    expect(screen.queryByText(/Rp\s?0/)).toBeNull();
    // Dua anggota: tanpa ajakan dan tanpa Aktivitas kosong; checklist tetap.
    expect(screen.queryByText('Farida belum bergabung di Bersama.')).toBeNull();
    expect(screen.getByRole('region', { name: 'Mulai dari sini' })).toBeTruthy();
  });

  it('solo + kosong: urutan kosong, ajakan, checklist, Aktivitas', () => {
    const { container } = render(
      view({
        ...kosong,
        bersama: { members: 1, isOwner: true, empty: true, pendingInvite: null },
      }),
    );
    const order = [
      'Bersama belum punya dompet.',
      'Farida belum bergabung di Bersama.',
      'Mulai dari sini',
      'Aktivitas',
    ].map((t) => container.textContent.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('dompet tabungan saja dengan entri (tidak kosong): perilaku S6 (kartu Aman kosong B3)', () => {
    render(
      view({
        ...kosong,
        bersama: { members: 2, isOwner: true, empty: false },
      }),
    );
    expect(screen.getByTestId('balance-card')).toBeTruthy();
    expect(screen.queryByText('Bersama belum punya dompet.')).toBeNull();
  });
});

describe('BerandaReal Bersama dua anggota dan Pribadi (tidak berubah)', () => {
  it('Bersama dua anggota: tanpa ajakan, tanpa Aktivitas, pengantar S6', () => {
    render(view({ bersama: { members: 2, isOwner: true, empty: false } }));
    expect(screen.queryByText('Farida belum bergabung di Bersama.')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Aktivitas' })).toBeNull();
    expect(screen.getByText(/Farida dan kamu sama-sama bisa mencatat/)).toBeTruthy();
  });

  it('Pribadi: tanpa ajakan/aktivitas Bersama', () => {
    render(view({ invite: true }, 'pribadi'));
    expect(screen.queryByText('Farida belum bergabung di Bersama.')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Aktivitas' })).toBeNull();
  });
});
