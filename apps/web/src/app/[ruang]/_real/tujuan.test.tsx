import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountVM } from '@/features/ledger/types';
import { goal } from '@/features/tujuan/__fixtures__/goal';
import type { GoalData, GoalVM } from '@/features/tujuan/types';
import { savingsOf, TujuanFailed, TujuanLoading, TujuanPageView, type TujuanSlots } from './tujuan';

afterEach(cleanup);

vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));
vi.mock('@/features/shell/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const SLOTS: TujuanSlots = {
  add: ({ variant }) => (
    <button type="button" data-variant={variant}>
      Tambah tujuan
    </button>
  ),
  complete: (g) => <button type="button">{`Selesaikan tujuan ${g.name}`}</button>,
  edit: (g) => <button type="button">{`Ubah tujuan ${g.name}`}</button>,
  archive: (g) => <button type="button">{`Arsipkan tujuan ${g.name}`}</button>,
  restore: (g) => <button type="button">{`Pulihkan tujuan ${g.name}`}</button>,
};

const wallet = (id: string, over: Partial<AccountVM> = {}): AccountVM => ({
  id,
  name: `Tabungan ${id}`,
  pocket: 'tabungan',
  walletType: 'bank',
  openedOn: '2026-01-01',
  archived: false,
  balance: 0,
  ...over,
});

const data = (goals: GoalVM[], partnerName: string | null = null): GoalData => ({
  goals,
  partnerName,
});

const view = (goals: GoalVM[], accounts: AccountVM[], ruang: 'pribadi' | 'bersama' = 'pribadi') =>
  render(
    <TujuanPageView ruang={ruang} query="" data={data(goals)} accounts={accounts} slots={SLOTS} />,
  );

describe('savingsOf', () => {
  it('dompet tabungan aktif, dan yang belum punya tujuan aktif', () => {
    const accounts = [
      wallet('a1'),
      wallet('a2'),
      wallet('a3', { archived: true }),
      wallet('a4', { pocket: 'operasional' }),
    ];
    const r = savingsOf(accounts, [
      goal({ accountId: 'a1' }),
      goal({ goalId: 'g2', accountId: 'a2', status: 'archived' }),
    ]);
    expect(r.savings.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(r.free.map((a) => a.id)).toEqual(['a2']);
  });
});

describe('TujuanPageView (S13-TJ1, TJ2)', () => {
  it('segmen Pribadi: Anggaran, Tagihan, Tujuan (aktif), Utang', () => {
    view([goal()], [wallet('a1')]);
    const nav = screen.getByRole('navigation', { name: 'Bagian Rencana' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Anggaran', 'Tagihan', 'Tujuan', 'Utang']);
    expect(within(nav).getByRole('link', { name: 'Tujuan' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('segmen Bersama: tanpa Utang', () => {
    view([goal()], [wallet('a1')], 'bersama');
    const nav = screen.getByRole('navigation', { name: 'Bagian Rencana' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Anggaran', 'Tagihan', 'Tujuan']);
  });

  it('kosong tanpa dompet tabungan: ajakan Tambah dompet tabungan (tautan ke Dompet), tanpa Tambah tujuan', () => {
    view([], [wallet('a9', { pocket: 'operasional' })]);
    expect(screen.getByRole('heading', { name: 'Belum ada dompet tabungan.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tambah dompet tabungan' })).toHaveAttribute(
      'href',
      '/pribadi/dompet?tambah=1',
    );
    expect(screen.queryByRole('button', { name: 'Tambah tujuan' })).toBeNull();
  });

  it('kosong dengan dompet tabungan: Belum ada tujuan + Tambah tujuan utama', () => {
    view([], [wallet('a1')]);
    expect(screen.getByRole('heading', { name: 'Belum ada tujuan.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tambah tujuan' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
  });

  it('satu tujuan: kartu + Tambah tujuan sekunder bila masih ada dompet bebas; Lihat dompet ke Detail dompet', () => {
    view([goal()], [wallet('a1'), wallet('a2')]);
    expect(screen.getByRole('heading', { level: 2, name: 'Tujuan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tambah tujuan' })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
    expect(screen.getByRole('link', { name: 'Lihat dompet Tabungan BCA' })).toHaveAttribute(
      'href',
      '/pribadi/dompet/a1',
    );
  });

  it('semua dompet bertujuan: kalimat + Tambah dompet tabungan menggantikan tombol', () => {
    view([goal()], [wallet('a1')]);
    expect(screen.queryByRole('button', { name: 'Tambah tujuan' })).toBeNull();
    expect(screen.getByText(/Semua dompet tabungan sudah punya tujuan/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tambah dompet tabungan' })).toBeTruthy();
  });

  it('banyak tujuan: urutan dari SQL dipertahankan', () => {
    view(
      [
        goal({ goalId: 'g1', name: 'Pertama' }),
        goal({ goalId: 'g2', accountId: 'a2', name: 'Kedua' }),
      ],
      [wallet('a1'), wallet('a2')],
    );
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['Pertama', 'Kedua']);
  });

  it('terlipat Selesai dan diarsipkan (n): hanya bila ada; berisi Pulihkan', () => {
    view(
      [
        goal(),
        goal({
          goalId: 'g2',
          accountId: 'a2',
          name: 'Liburan',
          status: 'completed',
          completedOn: '2026-10-01',
        }),
        goal({
          goalId: 'g3',
          accountId: 'a3',
          name: 'Motor',
          status: 'archived',
          archivedOn: '2026-10-02',
        }),
      ],
      [wallet('a1'), wallet('a2')],
    );
    const summary = screen.getByText('Selesai dan diarsipkan (2)');
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Pulihkan tujuan Liburan', hidden: true }),
    ).toBeTruthy();
  });

  it('tanpa tujuan tertutup: tanpa grup terlipat', () => {
    view([goal()], [wallet('a1')]);
    expect(screen.queryByText(/Selesai dan diarsipkan/)).toBeNull();
  });

  it('tercapai: Selesaikan tujuan ada di kartu', () => {
    view(
      [
        goal({
          reached: true,
          pct: 100,
          saved: 10_000_000,
          balance: 10_000_000,
          remaining: 0,
          perPeriod: null,
        }),
      ],
      [wallet('a1')],
    );
    expect(screen.getByRole('button', { name: 'Selesaikan tujuan Dana darurat' })).toBeTruthy();
  });

  it('galat memuat: Segmen tetap tampil, ErrorState dengan Coba lagi', () => {
    render(<TujuanFailed ruang="pribadi" query="" />);
    expect(screen.getByRole('navigation', { name: 'Bagian Rencana' })).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('Tujuan belum bisa dimuat.');
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  });

  it('memuat: Segmen + Memuat tujuan…', () => {
    render(<TujuanLoading ruang="bersama" query="" />);
    expect(screen.getByRole('status')).toHaveTextContent('Memuat tujuan…');
  });

  it('tanpa kata Goal, tanda seru, rumah tangga di layar', () => {
    view([goal({ reached: true })], [wallet('a1'), wallet('a2')]);
    const t = document.body.textContent.toLowerCase();
    expect(t).not.toContain('goal');
    expect(t).not.toContain('!');
    expect(t).not.toContain('rumah tangga');
  });
});
