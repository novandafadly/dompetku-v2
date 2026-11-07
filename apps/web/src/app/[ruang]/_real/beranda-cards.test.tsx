import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BillDueVM, BudgetOverviewVM } from '@/features/rencana/types';
import { BillsDueCard } from './bills-due-view';
import { BudgetsNearCard } from './budgets-near-view';

afterEach(cleanup);

const bill = (over: Partial<BillDueVM>): BillDueVM => ({
  occurrenceId: 'o1',
  billId: 'b1',
  name: 'Listrik PLN',
  amount: 485_000,
  dueOn: '2030-01-01',
  daysUntil: 2,
  overdue: false,
  posted: false,
  skipped: false,
  entryId: null,
  paidOn: null,
  ...over,
});

const budget = (over: Partial<BudgetOverviewVM>): BudgetOverviewVM => ({
  categoryId: 'c1',
  name: 'Makan Siang & Minum',
  icon: 'x',
  budget: 1_000_000,
  wajib: false,
  spent: 850_000,
  pct: 85,
  remaining: 150_000,
  archived: false,
  ...over,
});

describe('BillsDueCard (S9-BR2)', () => {
  it('daftar: tanggal, nama, label jatuh tempo, nominal; tautan Semua ke Rencana', () => {
    render(
      <BillsDueCard
        ruang="pribadi"
        query=""

        data={{
          hasBills: true,
          items: [
            bill({
              occurrenceId: 'o0',
              name: 'Internet',
              dueOn: '2030-01-01',
              daysUntil: -3,
              overdue: true,
            }),
            bill({}),
          ],
        }}
      />,
    );
    const card = screen.getByRole('region', { name: 'Tagihan 7 hari' });
    expect(within(card).getByText('Lewat 3 hari')).toBeTruthy();
    expect(within(card).getByText('2 hari lagi')).toBeTruthy();
    expect(within(card).getByText('Listrik PLN')).toBeTruthy();
    const link = within(card).getByRole('link', { name: /Semua\s+tagihan/ });
    expect(link.getAttribute('href')).toBe('/pribadi/rencana?bagian=tagihan');
  });

  it('maks lima baris', () => {
    const items = Array.from({ length: 7 }, (_, i) =>
      bill({ occurrenceId: `o${String(i)}`, name: `T${String(i)}` }),
    );
    render(<BillsDueCard ruang="pribadi" query="" data={{ hasBills: true, items }} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('belum punya tagihan: ajakan Tambah tagihan', () => {
    render(
      <BillsDueCard
        ruang="bersama"
        query=""

        data={{ hasBills: false, items: [] }}
      />,
    );
    expect(screen.getByText('Belum ada tagihan.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tambah tagihan' }).getAttribute('href')).toBe(
      '/bersama/rencana?bagian=tagihan',
    );
  });

  it('punya tagihan tapi tak ada yang dekat: tanpa Semua', () => {
    render(
      <BillsDueCard
        ruang="pribadi"
        query=""

        data={{ hasBills: true, items: [] }}
      />,
    );
    expect(screen.getByText('Tidak ada tagihan 7 hari ke depan.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Semua/ })).toBeNull();
  });

  it('galat: pesan + Coba lagi, tanpa menjatuhkan', () => {
    render(<BillsDueCard ruang="pribadi" query="" data="error" />);
    expect(screen.getByText('Tagihan belum bisa dimuat.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Coba lagi' }).getAttribute('href')).toBe(
      '/pribadi/beranda',
    );
  });

  it('query tema ikut ke tautan', () => {
    render(
      <BillsDueCard
        ruang="pribadi"
        query="?theme=light"

        data={{ hasBills: true, items: [bill({})] }}
      />,
    );
    expect(screen.getByRole('link', { name: /Semua/ }).getAttribute('href')).toBe(
      '/pribadi/rencana?bagian=tagihan&theme=light',
    );
  });
});

describe('BudgetsNearCard (S9-BR2)', () => {
  it('baris baca: nama, persen, sisa; tanpa tombol; Semua ke anggaran', () => {
    render(
      <BudgetsNearCard
        ruang="pribadi"
        query=""
        data={{
          hasBudgets: true,
          items: [
            budget({}),
            budget({
              categoryId: 'c2',
              name: 'Transport',
              wajib: true,
              pct: 100,
              spent: 500_000,
              budget: 500_000,
              remaining: 0,
            }),
          ],
        }}
      />,
    );
    const card = screen.getByRole('region', { name: 'Anggaran hampir habis' });
    expect(within(card).getByText('85% terpakai')).toBeTruthy();
    expect(within(card).getByText('Terpakai penuh')).toBeTruthy();
    expect(within(card).getByText('Wajib')).toBeTruthy();
    expect(within(card).queryByRole('button')).toBeNull();
    expect(
      within(card)
        .getByRole('link', { name: /Semua\s+anggaran/ })
        .getAttribute('href'),
    ).toBe('/pribadi/rencana');
  });

  it('URL kanonik tanpa bagian; query tema ikut', () => {
    render(
      <BudgetsNearCard
        ruang="pribadi"
        query="?theme=light"
        data={{ hasBudgets: true, items: [budget({})] }}
      />,
    );
    expect(screen.getByRole('link', { name: /Semua/ }).getAttribute('href')).toBe(
      '/pribadi/rencana?theme=light',
    );
  });

  it('belum punya anggaran: ajakan Atur anggaran', () => {
    render(<BudgetsNearCard ruang="pribadi" query="" data={{ hasBudgets: false, items: [] }} />);
    expect(screen.getByText('Belum ada anggaran.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Atur anggaran' }).getAttribute('href')).toBe(
      '/pribadi/rencana',
    );
  });

  it('punya anggaran tapi tak ada yang mendekati batas', () => {
    render(<BudgetsNearCard ruang="pribadi" query="" data={{ hasBudgets: true, items: [] }} />);
    expect(screen.getByText('Belum ada anggaran yang mendekati batas.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Semua/ })).toBeNull();
  });

  it('galat per kartu', () => {
    render(<BudgetsNearCard ruang="bersama" query="" data="error" />);
    expect(screen.getByText('Anggaran belum bisa dimuat.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Coba lagi' }).getAttribute('href')).toBe(
      '/bersama/beranda',
    );
  });
});
