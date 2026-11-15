import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountVM } from '@/features/ledger/types';
import { goal } from '@/features/tujuan/__fixtures__/goal';
import type { DompetRiwayat } from '@/server/ledger/dompet';
import { DompetReal } from './dompet';
import { DompetDetailReal } from './dompet-detail';

afterEach(cleanup);

const hostProps = vi.hoisted(() => vi.fn());
vi.mock('./dompet-islands', () => ({
  AddWalletHostIsland: (p: { children: ReactNode }) => <div>{p.children}</div>,
  AddWalletTriggerIsland: () => <button type="button">Tambah dompet</button>,
}));
vi.mock('./dompet-actions-islands', () => ({
  ReconcileIsland: () => <button type="button">Cocokkan saldo</button>,
  ArchiveIsland: () => <button type="button">Arsipkan dompet</button>,
}));
vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));
vi.mock('./tujuan-islands', () => ({
  TujuanHostIsland: (p: { children: ReactNode; lockedWalletId?: string }) => {
    hostProps({ ...p, children: undefined });
    return <div data-testid="tujuan-host">{p.children}</div>;
  },
  AddGoalIsland: ({ label }: { label?: string }) => <button type="button">{label}</button>,
}));
// Slot kartu = tombol biasa (pulau klien sudah diuji di tujuan-client.test).
vi.mock('./tujuan-section', () => ({
  SLOTS: {
    complete: (g: { name: string }) => <button type="button">{`Selesaikan ${g.name}`}</button>,
    edit: (g: { name: string }) => <button type="button">{`Ubah tujuan ${g.name}`}</button>,
    archive: (g: { name: string }) => <button type="button">{`Arsipkan tujuan ${g.name}`}</button>,
  },
}));
vi.mock('@/features/shell/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const acc = (over: Partial<AccountVM> & Pick<AccountVM, 'id' | 'name' | 'balance'>): AccountVM => ({
  pocket: 'tabungan',
  walletType: 'bank',
  openedOn: '2026-11-01',
  archived: false,
  ...over,
});

describe('daftar Dompet: teks tujuan (S13-TJ10)', () => {
  const accounts = [
    acc({ id: 'a1', name: 'Tabungan BCA', balance: 4_500_000 }),
    acc({ id: 'a2', name: 'Dana liburan', balance: 0 }),
    acc({ id: 'a3', name: 'Kas', balance: 100_000, pocket: 'operasional' }),
  ];
  const view = (goalLines: Record<string, { name: string; pct: number; reached: boolean }>) =>
    render(
      <DompetReal
        ruang="pribadi"
        query=""
        today="2026-11-04"
        accounts={accounts}
        reimbursables={[]}
        archived={[]}
        goalLines={goalLines}
      />,
    );

  it('menggantikan baris tipe dompet bertujuan; dompet lain tetap menampilkan tipe', () => {
    view({ a1: { name: 'Dana darurat', pct: 45, reached: false } });
    const row = screen.getByRole('link', { name: /Tabungan BCA/ });
    expect(row).toHaveTextContent('Dana darurat · 45%');
    expect(row).not.toHaveTextContent('Bank');
    expect(within(row).getByTitle('Dana darurat')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Dana liburan/ })).toHaveTextContent('Bank');
    expect(screen.getByRole('link', { name: /Kas/ })).toHaveTextContent('Bank');
  });

  it('tercapai: kata Tercapai; saldo 0: 0% tanpa kalimat', () => {
    view({
      a1: { name: 'Dana darurat', pct: 100, reached: true },
      a2: { name: 'Liburan', pct: 0, reached: false },
    });
    expect(screen.getByRole('link', { name: /Tabungan BCA/ })).toHaveTextContent(
      'Dana darurat · Tercapai',
    );
    expect(screen.getByRole('link', { name: /Dana liburan/ })).toHaveTextContent('Liburan · 0%');
  });

  it('nama tujuan 60 huruf: dipotong satu baris tetapi teks penuh ada di DOM dan title', () => {
    const name = 'T'.repeat(60);
    view({ a1: { name, pct: 12, reached: false } });
    const row = screen.getByRole('link', { name: /Tabungan BCA/ });
    expect(row).toHaveTextContent(`${name} · 12%`);
    expect(within(row).getByTitle(name).querySelector('.truncate')).not.toBeNull();
  });

  it('tanpa tujuan: tampilan lama tidak berubah; kekayaan bersih tidak terpengaruh', () => {
    view({});
    expect(screen.getAllByText('Bank').length).toBe(3);
    expect(screen.getByTestId('net-worth')).toHaveTextContent('4.600.000');
    cleanup();
    view({ a1: { name: 'Dana darurat', pct: 45, reached: false } });
    expect(screen.getByTestId('net-worth')).toHaveTextContent('4.600.000');
  });
});

describe('Detail dompet: kartu tujuan (S13-TJ9) dan arsip ditolak (S13-TJ11)', () => {
  const data = (account: AccountVM): DompetRiwayat => ({
    account,
    entries: [],
    opening: [],
    hasMore: false,
  });
  const base = {
    ruang: 'pribadi' as const,
    today: '2026-11-04',
    query: '?theme=light',
    dompetHref: '/pribadi/dompet' as never,
    moreHref: null,
  };
  const tabungan = acc({ id: 'a1', name: 'Tabungan BCA', balance: 4_500_000 });

  it('tujuan aktif: kartu progres tanpa Lihat dompet + tautan Lihat semua tujuan', () => {
    render(
      <DompetDetailReal
        {...base}
        data={data(tabungan)}
        goal={{ goal: goal(), partnerName: null }}
      />,
    );
    const card = screen.getByRole('region', { name: 'Dana darurat' });
    expect(card).toHaveTextContent('45%');
    expect(within(card).queryByRole('link', { name: /Lihat dompet/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ubah tujuan Dana darurat' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lihat semua tujuan' })).toHaveAttribute(
      'href',
      '/pribadi/rencana?theme=light&bagian=tujuan',
    );
    expect(hostProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ lockedWalletId: 'a1', wallets: [], goals: [goal()] }),
    );
  });

  it('belum ada tujuan: ajakan Buat tujuan dengan dompet ini terkunci', () => {
    render(
      <DompetDetailReal {...base} data={data(tabungan)} goal={{ goal: null, partnerName: null }} />,
    );
    expect(screen.getByText('Belum ada tujuan untuk Tabungan BCA.')).toBeTruthy();
    expect(
      screen.getByText('Pasang target, dan progresnya mengikuti saldo dompet ini.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buat tujuan' })).toBeTruthy();
    expect(hostProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lockedWalletId: 'a1',
        wallets: [{ id: 'a1', name: 'Tabungan BCA', balance: 4_500_000 }],
        goals: [],
      }),
    );
  });

  it('galat memuat tujuan: kartu galat, saldo tetap tampil', () => {
    render(<DompetDetailReal {...base} data={data(tabungan)} goal="error" />);
    expect(screen.getByText('Tujuan belum bisa dimuat.')).toBeTruthy();
    expect(screen.getByTestId('wallet-balance')).toHaveTextContent('4.500.000');
  });

  it('dompet non-tabungan (goal tidak diberikan): tanpa apa pun tentang tujuan', () => {
    render(
      <DompetDetailReal
        {...base}
        data={data(acc({ id: 'a2', name: 'Kas', balance: 100_000, pocket: 'operasional' }))}
      />,
    );
    expect(screen.queryByText(/tujuan/i)).toBeNull();
    expect(screen.queryByTestId('tujuan-host')).toBeNull();
  });

  it('saldo 0 dengan tujuan aktif: tombol arsip diganti kartu tujuan + tautan Lihat tujuan', () => {
    render(
      <DompetDetailReal
        {...base}
        data={data({ ...tabungan, balance: 0 })}
        goal={{ goal: goal({ saved: 0, pct: 0, balance: 0 }), partnerName: null }}
      />,
    );
    expect(screen.queryByRole('button', { name: /Arsipkan dompet/ })).toBeNull();
    expect(
      screen.getByText(
        'Tabungan BCA masih punya tujuan aktif Dana darurat. Selesaikan atau arsipkan tujuannya dulu, lalu arsipkan dompet ini.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lihat tujuan' })).toHaveAttribute(
      'href',
      '/pribadi/rencana?theme=light&bagian=tujuan',
    );
  });

  it('saldo 0 tanpa tujuan: arsip tersedia; saldo ada + tujuan: pesan saldo lebih dulu', () => {
    render(
      <DompetDetailReal
        {...base}
        data={data({ ...tabungan, balance: 0 })}
        goal={{ goal: null, partnerName: null }}
      />,
    );
    expect(screen.getByRole('button', { name: /Arsipkan dompet/ })).toBeTruthy();
    cleanup();
    render(
      <DompetDetailReal
        {...base}
        data={data(tabungan)}
        goal={{ goal: goal(), partnerName: null }}
      />,
    );
    expect(screen.getByText(/masih berisi saldo/)).toBeTruthy();
    expect(screen.queryByText(/masih punya tujuan aktif/)).toBeNull();
  });

  it('galat tujuan + saldo 0: arsip tetap ditawarkan (server menolak, dialog menjelaskan)', () => {
    render(<DompetDetailReal {...base} data={data({ ...tabungan, balance: 0 })} goal="error" />);
    expect(screen.getByRole('button', { name: /Arsipkan dompet/ })).toBeTruthy();
  });

  it('dompet terarsip: kartu tujuan tidak dirender (loader tidak memberi goal)', () => {
    render(<DompetDetailReal {...base} data={data({ ...tabungan, archived: true, balance: 0 })} />);
    expect(screen.queryByTestId('tujuan-host')).toBeNull();
  });
});
