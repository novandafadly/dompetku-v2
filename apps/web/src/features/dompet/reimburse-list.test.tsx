import { cleanup, render, screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { afterEach, describe, expect, it } from 'vitest';
import type { AccountVM, ReimbursableVM } from '@/features/ledger/types';
import { waitingItems, WaitingReimburseList, WAITING_MAX } from './reimburse-list';

afterEach(cleanup);

const accounts: AccountVM[] = [
  {
    id: 'a1',
    name: 'BCA',
    pocket: 'operasional',
    walletType: 'bank',
    openedOn: '2026-10-01',
    archived: false,
    balance: 1,
  },
];

const BASE: AccountVM = {
  id: 'x',
  name: 'x',
  pocket: 'operasional',
  walletType: 'bank',
  openedOn: '2026-10-01',
  archived: false,
  balance: 1,
};

const r = (n: number, over: Partial<ReimbursableVM> = {}): ReimbursableVM => ({
  entryId: `e${String(n)}`,
  occurredOn: '2026-11-03',
  description: `Talangan ${String(n)}`,
  accountId: 'a1',
  amount: 500_000,
  reimbursed: 0,
  remaining: 500_000,
  ...over,
});

const href = (id: string) => `/pribadi/transaksi/${id}` as Route;

describe('waitingItems', () => {
  it('label keterangan, lalu nama kategori, lalu Talangan; dompet terarsip tetap bernama', () => {
    const items = waitingItems(
      [
        r(1, { description: null, categoryName: 'Transportasi' }),
        r(2, { description: null, categoryName: null }),
        r(3, { accountId: 'a9' }),
      ],
      [...accounts, { ...BASE, id: 'a9', name: 'Dompet Lama', archived: true }],
      '2026-11-04',
      href,
    );
    expect(items.map((i) => i.label)).toEqual(['Transportasi', 'Talangan', 'Talangan 3']);
    expect(items[2]?.meta).toContain('Dompet Lama');
  });

  it('label keterangan atau kategori; meta Talangan · dompet · hari; sebagian ditandai', () => {
    const items = waitingItems(
      [
        r(1),
        r(2, {
          description: null,
          occurredOn: '2026-11-04',
          reimbursed: 300_000,
          remaining: 200_000,
        }),
      ],
      accounts,
      '2026-11-04',
      href,
    );
    expect(items[0]).toMatchObject({
      label: 'Talangan 1',
      meta: 'Talangan · BCA · Kemarin',
      partial: false,
      href: '/pribadi/transaksi/e1',
    });
    expect(items[1]).toMatchObject({
      label: 'Talangan',
      meta: 'Talangan · BCA · Hari ini',
      partial: true,
      remaining: 200_000,
      total: 500_000,
    });
  });
});

describe('WaitingReimburseList (S7-W4)', () => {
  it('kartu Menunggu reimburse: total sisa semua, baris tertaut ke Detail, daftar berlabel', () => {
    const all = [r(1), r(2, { reimbursed: 300_000, remaining: 200_000 })];
    render(
      <WaitingReimburseList
        items={waitingItems(all, accounts, '2026-11-04', href)}
        total={700_000}
      />,
    );
    const card = screen.getByRole('region', { name: 'Menunggu reimburse' });
    expect(card).toHaveTextContent('700.000');
    const list = within(card).getByRole('list', { name: 'Talangan menunggu reimburse' });
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/pribadi/transaksi/e1');
    // Hanya yang sudah diganti sebagian memuat status sisa dari total (ikon + teks).
    expect(links[1]).toHaveTextContent(/sisa\s*Rp\s*200\.000 dari\s*Rp\s*500\.000/);
    expect(links[0]).not.toHaveTextContent(/dari/);
  });

  it(`maksimal ${String(WAITING_MAX)} baris tanpa tautan Lihat semua (filter talangan belum ada di mode nyata)`, () => {
    const many = Array.from({ length: 8 }, (_, i) => r(i + 1));
    render(
      <WaitingReimburseList
        items={waitingItems(many, accounts, '2026-11-04', href)}
        total={4_000_000}
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(WAITING_MAX);
    expect(screen.queryByText(/Lihat semua/)).toBeNull();
  });

  it('kosong: tidak dirender sama sekali (tanpa placeholder)', () => {
    const { container } = render(<WaitingReimburseList items={[]} total={0} />);
    expect(container.textContent).toBe('');
  });
});
