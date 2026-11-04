import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountVM, EntryVM, ReimbursableVM } from '@/features/ledger/types';
import type { DompetRiwayat } from '@/server/ledger/dompet';
import { DompetFailed, DompetReal } from './dompet';
import { DompetDetailFailed, DompetDetailReal } from './dompet-detail';

afterEach(cleanup);

const host = vi.hoisted(() => vi.fn());
vi.mock('./dompet-islands', () => ({
  AddWalletHostIsland: (props: { children: ReactNode }) => {
    host({ ...props, children: undefined });
    return <div data-testid="host">{props.children}</div>;
  },
  AddWalletTriggerIsland: ({ className }: { className?: string }) => (
    <button type="button" className={className}>
      Tambah dompet
    </button>
  ),
}));
vi.mock('./dompet-actions-islands', () => ({
  ReconcileIsland: ({ ruang, account }: { ruang: string; account: { name: string } }) => (
    <button type="button" data-testid="reconcile" data-ruang={ruang}>
      {`Cocokkan saldo (${account.name})`}
    </button>
  ),
  ArchiveIsland: ({ ruang, account }: { ruang: string; account: { name: string } }) => (
    <button type="button" data-testid="archive" data-ruang={ruang}>
      {`Arsipkan dompet (${account.name})`}
    </button>
  ),
}));
vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));
vi.mock('@/features/shell/page-header', () => ({
  PageHeader: ({ title, action }: { title: string; action?: ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {action}
    </header>
  ),
}));

const acc = (over: Partial<AccountVM> & Pick<AccountVM, 'id' | 'name' | 'balance'>): AccountVM => ({
  pocket: 'operasional',
  walletType: 'bank',
  openedOn: '2026-11-01',
  archived: false,
  ...over,
});

describe('DompetReal', () => {
  it('daftar dari VM; tautan dompet membawa query tema; host menerima nama dompet', () => {
    render(
      <DompetReal
        ruang="pribadi"
        query="?theme=light"
        today="2026-11-04"
        accounts={[acc({ id: 'a1', name: 'BCA', balance: 1_250_000 })]}
        reimbursables={[]}
        archived={[]}
      />,
    );
    expect(screen.getByRole('link', { name: /BCA/ })).toHaveAttribute(
      'href',
      '/pribadi/dompet/a1?theme=light',
    );
    expect(screen.getByTestId('net-worth')).toHaveTextContent('1.250.000');
    expect(host).toHaveBeenCalledWith({
      ruang: 'pribadi',
      existingNames: ['BCA'],
      children: undefined,
    });
    // Cocokkan saldo dan arsip ada di riwayat dompet, bukan di daftar (S7-W1/W3).
    expect(screen.queryByText(/Cocokkan saldo/)).toBeNull();
    expect(screen.queryByText(/Arsipkan/)).toBeNull();
    // Tanpa talangan terbuka dan tanpa dompet terarsip: kartu S7 tidak dirender.
    expect(screen.queryByRole('region', { name: 'Menunggu reimburse' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Diarsipkan' })).toBeNull();
  });

  it('kosong: Belum ada dompet di {Ruang}. + Tambah dompet (satu tombol)', () => {
    render(
      <DompetReal
        ruang="bersama"
        query=""
        today="2026-11-04"
        accounts={[]}
        reimbursables={[]}
        archived={[]}
      />,
    );
    expect(screen.getByText('Belum ada dompet di Bersama.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Tambah dompet' }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('net-worth')).toBeNull();
  });
});

const open = (over: Partial<ReimbursableVM> = {}): ReimbursableVM => ({
  entryId: 'e-t1',
  occurredOn: '2026-11-03',
  description: 'Tiket dinas',
  accountId: 'a1',
  amount: 500_000,
  reimbursed: 0,
  remaining: 500_000,
  ...over,
});

describe('DompetReal S7: Menunggu reimburse dan Diarsipkan', () => {
  const accounts = [acc({ id: 'a1', name: 'BCA', balance: 1_250_000 })];
  const archived = [acc({ id: 'a9', name: 'Dompet Lama', balance: 0, archived: true })];

  it('Pribadi: kartu Menunggu reimburse tepat di atas kelompok dompet, tertaut ke Detail talangan', () => {
    render(
      <DompetReal
        ruang="pribadi"
        query="?theme=light"
        today="2026-11-04"
        accounts={accounts}
        reimbursables={[open(), open({ entryId: 'e-t2', description: null, remaining: 100_000 })]}
        archived={[]}
      />,
    );
    const waiting = screen.getByRole('region', { name: 'Menunggu reimburse' });
    expect(waiting).toHaveTextContent('600.000');
    expect(within(waiting).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      '/pribadi/transaksi/e-t1?theme=light',
    );
    expect(within(waiting).getByText('Talangan')).toBeTruthy();
    const ops = screen.getByRole('region', { name: 'Operasional' });
    expect(waiting.compareDocumentPosition(ops) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Bersama tidak pernah menampilkan Menunggu reimburse, bahkan bila datanya ikut terkirim', () => {
    render(
      <DompetReal
        ruang="bersama"
        query=""
        today="2026-11-04"
        accounts={accounts}
        reimbursables={[open()]}
        archived={[]}
      />,
    );
    expect(screen.queryByRole('region', { name: 'Menunggu reimburse' })).toBeNull();
    expect(screen.queryByText('Tiket dinas')).toBeNull();
  });

  it('dompet terarsip: kartu Diarsipkan di paling bawah, tertaut ke riwayat', () => {
    render(
      <DompetReal
        ruang="pribadi"
        query=""
        today="2026-11-04"
        accounts={accounts}
        reimbursables={[]}
        archived={archived}
      />,
    );
    const card = screen.getByRole('region', { name: 'Diarsipkan' });
    expect(within(card).getByRole('link', { name: /Dompet Lama/ })).toHaveAttribute(
      'href',
      '/pribadi/dompet/a9',
    );
    const ops = screen.getByRole('region', { name: 'Operasional' });
    expect(ops.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('semua dompet aktif kosong: kartu Menunggu reimburse tetap tampil bersama Diarsipkan', () => {
    render(
      <DompetReal
        ruang="pribadi"
        query=""
        today="2026-11-04"
        accounts={[]}
        reimbursables={[open({ accountId: 'a9' })]}
        archived={archived}
      />,
    );
    const waiting = screen.getByRole('region', { name: 'Menunggu reimburse' });
    expect(waiting).toHaveTextContent('Dompet Lama');
  });

  it('semua dompet terarsip: salinan kosong tetap, kartu Diarsipkan tetap ada', () => {
    render(
      <DompetReal
        ruang="pribadi"
        query=""
        today="2026-11-04"
        accounts={[]}
        reimbursables={[]}
        archived={archived}
      />,
    );
    expect(screen.getByText('Belum ada dompet di Pribadi.')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Diarsipkan' })).toBeTruthy();
  });
});

describe('DompetFailed', () => {
  it('salinan tetap + Coba lagi, tanpa data', () => {
    render(<DompetFailed />);
    expect(screen.getByRole('alert')).toHaveTextContent('Dompet belum bisa dimuat.');
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  });
});

const by = { id: 'u', name: 'Novanda', initial: 'N' };
const entry = (id: string, over: Partial<EntryVM>): EntryVM => ({
  id,
  version: 1,
  kind: 'expense',
  occurredOn: '2026-11-02',
  createdAt: '2026-11-02T08:00:00+07:00',
  createdBy: by,
  accountId: 'a1',
  accountName: 'BCA',
  amount: 25_000,
  categoryName: 'Makan Siang & Minum',
  ...over,
});

describe('DompetDetailReal', () => {
  const data: DompetRiwayat = {
    account: acc({ id: 'a1', name: 'BCA', balance: 475_000 }),
    entries: [
      entry('e-1', { description: 'Nasi padang' }),
      entry('e-2', {
        kind: 'transfer',
        amount: 500_000,
        counterAccountId: 'a2',
        counterAccountName: 'Tunai',
      }),
      entry('e-3', {
        kind: 'transfer',
        accountId: 'a2',
        accountName: 'Tunai',
        counterAccountId: 'a1',
        counterAccountName: 'BCA',
        amount: 100_000,
      }),
    ],
    opening: [
      entry('e-0', { kind: 'opening_balance', amount: 1_000_000, occurredOn: '2026-11-01' }),
    ],
    hasMore: true,
  };
  const props = {
    ruang: 'pribadi' as const,
    today: '2026-11-02',
    query: '',
    dompetHref: '/pribadi/dompet' as never,
    moreHref: '/pribadi/dompet/a1?tampil=100' as never,
    data,
  };

  it('saldo dari VM; efek per baris pada dompet ini; saldo awal terpisah di bawah; Muat lagi = tautan', () => {
    render(<DompetDetailReal {...props} />);
    expect(screen.getByTestId('wallet-balance')).toHaveTextContent('475.000');
    const today = screen.getByRole('list', { name: /Riwayat Hari ini/ });
    expect(screen.getByRole('link', { name: /Nasi padang/ })).toHaveTextContent('25.000');
    // Transfer keluar dari BCA mengurangi; transfer masuk ke BCA menambah.
    expect(screen.getByRole('link', { name: /BCA → Tunai/ })).toHaveTextContent('500.000');
    expect(today).toHaveTextContent('−');
    expect(screen.getByRole('link', { name: /Tunai → BCA/ })).toHaveTextContent('100.000');
    const opening = screen.getByRole('list', { name: 'Riwayat Entri pembuka' });
    expect(opening).toHaveTextContent('Saldo awal');
    expect(opening).toHaveTextContent('1.000.000');
    expect(screen.getByRole('link', { name: /Muat lagi/ })).toHaveAttribute(
      'href',
      '/pribadi/dompet/a1?tampil=100',
    );
    expect(screen.getByRole('link', { name: 'Dompet' })).toHaveAttribute('href', '/pribadi/dompet');
  });

  it('semua tampil: tanpa Muat lagi; kosong: salinan tetap', () => {
    render(
      <DompetDetailReal
        {...props}
        moreHref={null}
        data={{ ...data, entries: [], opening: [], hasMore: false }}
      />,
    );
    expect(screen.queryByRole('link', { name: /Muat lagi/ })).toBeNull();
    expect(screen.getByText('Belum ada transaksi di dompet ini.')).toBeTruthy();
  });
});

describe('DompetDetailReal S7: Cocokkan saldo, saldo awal, arsip', () => {
  const account = acc({ id: 'a1', name: 'BCA', balance: 475_000, openedOn: '2026-11-01' });
  const base: DompetRiwayat = {
    account,
    entries: [],
    opening: [
      entry('e-0', { kind: 'opening_balance', amount: 1_000_000, occurredOn: '2026-11-01' }),
    ],
    hasMore: false,
  };
  const props = {
    ruang: 'pribadi' as const,
    today: '2026-11-02',
    query: '?theme=light',
    dompetHref: '/pribadi/dompet' as never,
    moreHref: null,
    data: base,
  };

  it('Cocokkan saldo ada di kepala dompet aktif; membawa id, nama, dan saldo', () => {
    render(<DompetDetailReal {...props} />);
    expect(screen.getByTestId('reconcile')).toHaveTextContent('Cocokkan saldo (BCA)');
  });

  it('Ubah saldo awal hanya ≤ 7 hari: tautan ke Detail entri saldo awal dengan nama berlabel', () => {
    render(<DompetDetailReal {...props} />);
    const link = screen.getByRole('link', { name: 'Ubah saldo awal BCA' });
    expect(link).toHaveAttribute('href', '/pribadi/transaksi/e-0?theme=light');
    expect(link).toHaveTextContent('Ubah saldo awal');
  });

  it('lewat 7 hari: tanpa tautan Ubah saldo awal (Cocokkan saldo tetap ada)', () => {
    render(<DompetDetailReal {...props} today="2026-11-20" />);
    expect(screen.queryByRole('link', { name: /Ubah saldo awal/ })).toBeNull();
    expect(screen.getByTestId('reconcile')).toBeTruthy();
  });

  it('dompet tanpa entri saldo awal: tanpa tautan', () => {
    render(<DompetDetailReal {...props} data={{ ...base, opening: [] }} />);
    expect(screen.queryByRole('link', { name: /Ubah saldo awal/ })).toBeNull();
  });

  it('saldo 0: tombol Arsipkan dompet (pulau) dan tanpa kartu keterangan', () => {
    render(
      <DompetDetailReal
        {...props}
        data={{ ...base, account: { ...account, balance: 0 } }}
        ruang="bersama"
      />,
    );
    expect(screen.getByTestId('archive')).toHaveAttribute('data-ruang', 'bersama');
    expect(screen.queryByText(/masih berisi saldo/)).toBeNull();
  });

  it('saldo ≠ 0: kartu keterangan menggantikan tombol arsip', () => {
    render(<DompetDetailReal {...props} />);
    expect(screen.queryByTestId('archive')).toBeNull();
    expect(
      screen.getByText('BCA masih berisi saldo. Pindahkan isinya dengan Transfer, lalu arsipkan.'),
    ).toBeTruthy();
  });

  it('dompet terarsip: riwayat saja, tanpa Cocokkan saldo, Ubah saldo awal, atau arsip', () => {
    render(
      <DompetDetailReal
        {...props}
        data={{ ...base, account: { ...account, balance: 0, archived: true } }}
      />,
    );
    expect(screen.queryByTestId('reconcile')).toBeNull();
    expect(screen.queryByTestId('archive')).toBeNull();
    expect(screen.queryByRole('link', { name: /Ubah saldo awal/ })).toBeNull();
    expect(
      screen.getByText('Dompet ini sudah diarsipkan. Riwayatnya tetap bisa dilihat.'),
    ).toBeTruthy();
  });
});

describe('DompetDetailFailed', () => {
  it('kembali ke Dompet + salinan gagal muat + Coba lagi', () => {
    render(<DompetDetailFailed dompetHref={'/pribadi/dompet' as never} />);
    expect(screen.getByRole('link', { name: 'Dompet' })).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('Riwayat dompet belum bisa dimuat.');
  });
});
