import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Ruang, SafeToSpendFullVM } from '@/features/ledger/types';
import { AmanCardView } from './aman-card-view';

afterEach(cleanup);

/** `formatRupiah` memakai spasi tak terputus; tes membandingkan dengan spasi biasa. */
const norm = (s: string | null | undefined) => (s ?? '').replaceAll('\u00a0', ' ');

const BASE: SafeToSpendFullVM = {
  operasional: 5_000_000,
  billsUntilEom: 700_000,
  budgetWajibRemaining: 300_000,
  aman: 4_000_000,
  until: '2026-11-24',
  daysLeft: 20,
  perDay: 200_000,
  status: 'aman',
  reason: null,
  hasObligations: true,
};

function show(
  over: Partial<SafeToSpendFullVM> = {},
  opts: { ruang?: Ruang; holidayNote?: boolean } = {},
) {
  return render(
    <AmanCardView
      ruang={opts.ruang ?? 'pribadi'}
      vm={{ ...BASE, ...over }}
      holidayNote={opts.holidayNote ?? false}
    />,
  );
}

describe('AmanCardView (S9-BR1)', () => {
  it('judul memakai akhir periode gajian, bukan akhir bulan', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Aman dipakai sampai 24 Nov' })).toBeTruthy();
  });

  it('Bersama: judul dan sebab memakai kata bersama', () => {
    show(
      { status: 'hati_hati', reason: { kind: 'pace', avgDaily: 250_000 } },
      { ruang: 'bersama' },
    );
    expect(
      screen.getByRole('heading', { name: 'Aman dipakai bersama sampai 24 Nov' }),
    ).toBeTruthy();
    expect(
      screen.getByText('Rata-rata belanja bersama Rp 250.000 per hari, lebih dari jatah harian.'),
    ).toBeTruthy();
  });

  it('Aman: ikon + teks Aman, tanpa kalimat sebab, baris per hari tetap', () => {
    show();
    const status = screen.getByTestId('aman-status');
    expect(norm(status.textContent)).toContain('Aman');
    expect(status.querySelector('svg')).not.toBeNull();
    expect(norm(screen.getByText(/per hari untuk 20 hari/).textContent)).toContain('Rp 200.000');
    expect(screen.queryByText(/lewat jatuh tempo/)).toBeNull();
  });

  it('Hati-hati karena tagihan lewat: sebab overdue dengan jumlah', () => {
    show({ status: 'hati_hati', reason: { kind: 'overdue', count: 2 } });
    const status = screen.getByTestId('aman-status');
    expect(norm(status.textContent)).toContain('Hati-hati');
    expect(norm(status.textContent)).toContain('Ada 2 tagihan lewat jatuh tempo.');
    expect(status.querySelector('svg')).not.toBeNull();
    // Baris per hari tidak pindah ke dalam kotak status.
    expect(screen.getByText(/per hari untuk 20 hari/)).toBeTruthy();
  });

  it('Hati-hati karena laju belanja', () => {
    show({ status: 'hati_hati', reason: { kind: 'pace', avgDaily: 250_000 } });
    expect(norm(screen.getByTestId('aman-status').textContent)).toContain(
      'Rata-rata belanjamu Rp 250.000 per hari, lebih dari jatah harian.',
    );
  });

  it('Lewat batas: angka danger, kotak status menggantikan baris per hari', () => {
    show({ aman: -100_000, perDay: -5_000, status: 'lewat' });
    const status = screen.getByTestId('aman-status');
    expect(norm(status.textContent)).toContain('Lewat batas');
    expect(norm(status.textContent)).toContain(
      'Pengeluaran wajib periode ini melebihi saldo operasional.',
    );
    expect(screen.queryByText(/per hari untuk/)).toBeNull();
    expect(screen.getByTestId('hero-amount').className).toContain('text-danger');
  });

  it('Lewat batas tanpa kewajiban: salinan saldo minus', () => {
    show({ aman: -1, status: 'lewat', hasObligations: false });
    expect(norm(screen.getByTestId('aman-status').textContent)).toContain(
      'Saldo operasional sudah minus.',
    );
  });

  it('rincian dengan kewajiban: empat baris, tanggal akhir periode, bilah memuat empat angka', () => {
    show();
    const table = screen.getByRole('table', { name: 'Rincian aman dipakai' });
    expect(within(table).getByRole('rowheader', { name: 'Saldo operasional' })).toBeTruthy();
    expect(within(table).getByRole('rowheader', { name: 'Tagihan s.d. 24 Nov' })).toBeTruthy();
    expect(within(table).getByRole('rowheader', { name: 'Sisa anggaran wajib' })).toBeTruthy();
    expect(within(table).getByRole('rowheader', { name: 'Aman dipakai' })).toBeTruthy();
    const bar = screen.getByRole('img');
    expect(norm(bar.getAttribute('aria-label'))).toBe(
      'Saldo operasional Rp 5.000.000: aman Rp 4.000.000, tagihan Rp 700.000, sisa anggaran wajib Rp 300.000',
    );
  });

  it('tanpa kewajiban: hanya dua baris, tanpa Rp 0 palsu', () => {
    show({ hasObligations: false, billsUntilEom: 0, budgetWajibRemaining: 0, aman: 5_000_000 });
    const table = screen.getByRole('table', { name: 'Rincian aman dipakai' });
    expect(within(table).queryByRole('rowheader', { name: /Tagihan/ })).toBeNull();
    expect(within(table).queryByRole('rowheader', { name: /anggaran wajib/ })).toBeNull();
    expect(within(table).getAllByRole('rowheader')).toHaveLength(2);
  });

  it('sisa wajib 0 dengan kewajiban tetap tampil sebagai Rp 0', () => {
    show({ budgetWajibRemaining: 0, aman: 4_300_000 });
    const row = screen.getByRole('rowheader', { name: 'Sisa anggaran wajib' }).closest('tr');
    expect(norm(row?.textContent)).toContain('Rp 0');
  });

  it('tanda libur hanya bila diminta, dengan tahun akhir periode', () => {
    show({}, { holidayNote: false });
    expect(screen.queryByText(/Libur nasional/)).toBeNull();
    cleanup();
    show({}, { holidayNote: true });
    expect(
      screen.getByText('Libur nasional 2026 belum diisi; hari gajian dihitung tanpa libur.'),
    ).toBeTruthy();
  });

  it('Server Component: tanpa use client dan tanpa impor demo (budget Beranda prototipe)', () => {
    const dirs = ['src/features/beranda', 'src/app/[ruang]/_real'];
    const files: [string, string][] = [
      [dirs[0] ?? '', 'aman-card-view.tsx'],
      [dirs[1] ?? '', 'bills-due-view.tsx'],
      [dirs[1] ?? '', 'budgets-near-view.tsx'],
    ];
    for (const [dir, f] of files) {
      const src = readFileSync(path.join(process.cwd(), dir, f), 'utf8');
      expect(src, f).not.toMatch(/^['"]use client['"]/m);
      expect(src, f).not.toMatch(/demo-data|demo-context/);
    }
  });
});
