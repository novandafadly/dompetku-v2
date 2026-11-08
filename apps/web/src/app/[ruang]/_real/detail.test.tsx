import { formatRupiah } from '@dompetku/domain';
import { render, screen } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it, vi } from 'vitest';
import type { AccountVM, EntryVM, TalanganVM } from '@/features/ledger/types';
import { entryTitleVM } from '@/features/ledger/present';
import { DetailFailed, DetailReal, detailAbilities } from './detail';

vi.mock('./detail-islands', () => ({
  DetailActionsIsland: ({
    editable,
    voidable,
    moveTo,
    reimbursable,
    canGiveUp,
  }: {
    editable: boolean;
    voidable: boolean;
    moveTo: string | null;
    reimbursable: { remaining: number } | null;
    canGiveUp: boolean;
  }) => (
    <div>
      {reimbursable ? <button type="button">Catat reimburse</button> : null}
      {reimbursable && canGiveUp ? <button type="button">Tidak diganti</button> : null}
      {editable ? <button type="button">Ubah</button> : null}
      {voidable ? <button type="button">Batalkan transaksi</button> : null}
      {moveTo ? <button type="button">{`Pindahkan ke ${moveTo}`}</button> : null}
    </div>
  ),
  RestoreIsland: () => <button type="button">Pulihkan</button>,
}));
vi.mock('./transaksi-islands', () => ({
  RetryIsland: () => <button type="button">Coba lagi</button>,
}));

const TODAY = '2026-11-02';

const ACCOUNT: AccountVM = {
  id: 'acc-1',
  name: 'BCA',
  pocket: 'operasional',
  walletType: 'bank',
  openedOn: '2026-10-28',
  archived: false,
  balance: 100_000,
};

function entry(over: Partial<EntryVM> = {}): EntryVM {
  return {
    id: 'e1',
    version: 2,
    kind: 'expense',
    occurredOn: TODAY,
    createdAt: '2026-11-02T08:00:00+07:00',
    createdBy: { id: 'u-n', name: 'Novanda', initial: 'N' },
    accountId: 'acc-1',
    accountName: 'BCA',
    amount: 25_000,
    categoryName: 'Makan',
    description: 'Nasi padang',
    ...over,
  };
}

const data = (
  e: EntryVM,
  restoreClosed = false,
  extra: { spaceCount?: number; talangan?: TalanganVM | null; accounts?: AccountVM[] } = {},
) => ({
  entry: e,
  history: [],
  accounts: extra.accounts ?? [ACCOUNT],
  categories: [],
  restoreClosed,
  spaceCount: extra.spaceCount ?? 2,
  talangan: extra.talangan ?? null,
});

const labels = {
  title: 'Nasi padang',
  category: 'Makan',
  amount: { value: -25_000, kind: 'expense' as const },
};

const props = { ruang: 'pribadi' as const, today: TODAY, listHref: '/pribadi/transaksi' as Route };

describe('detailAbilities (sesuai api.update_entry / void_entry / move_entry_to_space)', () => {
  const ab = (
    e: EntryVM,
    over: { accounts?: AccountVM[]; spaceCount?: number; talangan?: TalanganVM | null } = {},
    today = TODAY,
    me = 'u-n',
  ) =>
    detailAbilities(
      e,
      {
        accounts: over.accounts ?? [ACCOUNT],
        spaceCount: over.spaceCount ?? 2,
        talangan: over.talangan ?? null,
      },
      today,
      me,
    );
  const NONE = { editable: false, voidable: false, movable: false, reimbursable: null };

  it('pemasukan/pengeluaran hidup oleh pencatat: Ubah, Batalkan, Pindahkan', () => {
    expect(ab(entry())).toEqual({
      editable: true,
      voidable: true,
      movable: true,
      reimbursable: null,
    });
    expect(ab(entry({ kind: 'income' }))).toMatchObject({
      editable: true,
      voidable: true,
      movable: true,
    });
  });

  it('Pindahkan hanya untuk pencatat (R10), anggota ≥ 2 ruang, bukan Kantor, bukan talangan', () => {
    expect(ab(entry(), {}, TODAY, 'u-f').movable).toBe(false);
    expect(ab(entry(), { spaceCount: 1 }).movable).toBe(false);
    expect(ab(entry(), { accounts: [{ ...ACCOUNT, pocket: 'kantor' }] }).movable).toBe(false);
    expect(ab(entry({ reimbursable: true })).movable).toBe(false);
  });

  it('transfer dan cocokkan saldo: hanya Batalkan (api.update_entry menolak kind_not_editable)', () => {
    expect(ab(entry({ kind: 'transfer', counterAccountName: 'Tunai' }))).toEqual({
      ...NONE,
      voidable: true,
    });
    expect(ab(entry({ kind: 'adjustment', direction: 'in' }))).toEqual({ ...NONE, voidable: true });
  });

  it('saldo awal: Ubah (nominal) hanya ≤ 7 hari sejak dompet dibuka, tidak pernah Batalkan', () => {
    const opening = entry({ kind: 'opening_balance' });
    expect(ab(opening, {}, '2026-11-04')).toEqual({ ...NONE, editable: true });
    expect(ab(opening, {}, '2026-11-05')).toEqual(NONE);
  });

  it('antar ruang: Batalkan hanya untuk pencatat (R25), tidak pernah Ubah atau Pindahkan', () => {
    const st = entry({ kind: 'space_transfer', direction: 'out' });
    expect(ab(st)).toEqual({ ...NONE, voidable: true });
    expect(ab(st, {}, TODAY, 'u-f')).toEqual(NONE);
  });

  it('entri batal atau sudah dipindah: tanpa aksi', () => {
    expect(ab(entry({ voidedAt: '2026-11-02T09:00:00+07:00' }))).toEqual(NONE);
    expect(
      ab(entry({ voidedAt: '2026-11-02T09:00:00+07:00', movedAt: '2026-11-02T09:00:00+07:00' })),
    ).toEqual(NONE);
  });

  it('talangan: sisa > 0 = Catat reimburse; reimburse hidup = Batalkan hilang; lunas = tanpa aksi reimburse', () => {
    const t = entry({ reimbursable: true });
    expect(ab(t, { talangan: { items: [], reimbursed: 0, remaining: 25_000 } })).toEqual({
      editable: true,
      voidable: true,
      movable: false,
      reimbursable: { remaining: 25_000 },
    });
    const partial: TalanganVM = {
      items: [{ id: 'r1', occurredOn: TODAY, amount: 10_000 }],
      reimbursed: 10_000,
      remaining: 15_000,
    };
    expect(ab(t, { talangan: partial })).toMatchObject({
      voidable: false,
      reimbursable: { remaining: 15_000 },
    });
    const lunas: TalanganVM = { items: partial.items, reimbursed: 25_000, remaining: 0 };
    expect(ab(t, { talangan: lunas })).toMatchObject({ voidable: false, reimbursable: null });
  });

  it('reimburse: bisa dibatalkan, tidak diubah atau dipindah', () => {
    expect(ab(entry({ kind: 'reimbursement', reimbursesEntryId: 't1' }))).toEqual({
      ...NONE,
      voidable: true,
    });
  });
});

describe('DetailReal', () => {
  it('hidup: Ubah, Batalkan, dan Pindahkan ke ruang tujuan (S7-D2); dicatat oleh Kamu', () => {
    render(<DetailReal {...props} me="u-n" data={data(entry())} labels={labels} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Nasi padang' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ubah' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Batalkan transaksi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pindahkan ke bersama' })).toBeTruthy();
    expect(screen.getByText('Kamu')).toBeTruthy();
    expect(screen.queryByText('Transaksi ini sudah dibatalkan.')).toBeNull();
  });

  it('dicatat orang lain: namanya', () => {
    render(<DetailReal {...props} me="u-f" data={data(entry())} labels={labels} />);
    expect(screen.getByText('Novanda')).toBeTruthy();
  });

  it('dibatalkan (S6-D3): banner + Pulihkan, nominal dicoret dengan teks dibatalkan, tanpa Ubah', () => {
    const { container } = render(
      <DetailReal
        {...props}
        me="u-n"
        data={data(entry({ voidedAt: '2026-11-02T09:00:00+07:00' }))}
        labels={labels}
      />,
    );
    expect(screen.getByText('Transaksi ini sudah dibatalkan.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pulihkan' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Batalkan transaksi' })).toBeNull();
    expect(container.querySelector('.line-through')).not.toBeNull();
    expect(screen.getByText('dibatalkan').className).toContain('sr-only');
  });

  it('dibatalkan lewat 90 hari: teks S6-S1 lewat, tanpa Pulihkan', () => {
    render(
      <DetailReal
        {...props}
        me="u-n"
        data={data(entry({ voidedAt: '2026-07-01T09:00:00+07:00' }), true)}
        labels={labels}
      />,
    );
    expect(
      screen.getByText('Lewat 90 hari, transaksi ini tidak bisa dipulihkan lagi.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pulihkan' })).toBeNull();
  });

  it('gagal muat: salinan tetap + Coba lagi + kembali ke Transaksi', () => {
    render(<DetailFailed listHref={props.listHref} />);
    expect(screen.getByText('Transaksi belum bisa dimuat.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Transaksi/ }).getAttribute('href')).toBe(
      '/pribadi/transaksi',
    );
  });
});

const BERSAMA_ACCOUNT: AccountVM = { ...ACCOUNT, id: 'acc-b', name: 'Kas Bersama' };

/** Kaki Bersama transfer antar ruang seperti keluaran loader: tanpa dompet/keterangan Pribadi. */
const kakiBersama = (over: Partial<EntryVM> = {}): EntryVM =>
  entry({
    id: 'eb',
    kind: 'space_transfer',
    spaceKind: 'shared',
    direction: 'in',
    accountId: 'acc-b',
    accountName: 'Kas Bersama',
    categoryName: undefined as never,
    description: undefined as never,
    sharedNote: 'Patungan listrik',
    ...over,
  });

describe('DetailReal antar ruang (S7-D1)', () => {
  const bersamaProps = {
    ...props,
    ruang: 'bersama' as const,
    listHref: '/bersama/transaksi' as Route,
  };
  const bLabels = (e: EntryVM) => ({
    title: entryTitleVM(e),
    category: 'Antar ruang',
    amount: { value: e.amount, kind: 'neutral' as const },
  });

  it('kaki Bersama (props sebentuk keluaran loadDetail): judul nama pencatat, dompet Bersama, tanpa jejak Pribadi', () => {
    const e = kakiBersama();
    const { container } = render(
      <DetailReal
        {...bersamaProps}
        me="u-f"
        data={data(e, false, { accounts: [BERSAMA_ACCOUNT] })}
        labels={bLabels(e)}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Setoran dari Novanda' })).toBeTruthy();
    expect(screen.getByText('Kas Bersama')).toBeTruthy();
    expect(screen.getByText('Patungan listrik')).toBeTruthy();
    // Ruang: hanya Bersama (tanpa panah), jenis Antar ruang.
    expect(container.textContent).not.toContain('→');
    for (const bocor of ['BCA Pribadi', 'bayar kos adik', 'Pribadi']) {
      expect(container.textContent).not.toContain(bocor);
    }
    expect(container.innerHTML).not.toContain('bayar kos adik');
  });

  it('kaki Bersama dilihat bukan pencatat: tanpa Batalkan, baris Hanya {Nama}', () => {
    const e = kakiBersama({ direction: 'out' });
    render(
      <DetailReal
        {...bersamaProps}
        me="u-f"
        data={data(e, false, { accounts: [BERSAMA_ACCOUNT] })}
        labels={bLabels(e)}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Diambil oleh Novanda' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Batalkan transaksi' })).toBeNull();
    expect(screen.getByText('Hanya Novanda yang bisa membatalkan transfer ini.')).toBeTruthy();
  });

  it('kaki keluar Bersama dengan biaya: baris Biaya; kaki masuk tanpa biaya (S8-D1a)', () => {
    const keluar = kakiBersama({ direction: 'out', fee: 2_500 });
    const { container, unmount } = render(
      <DetailReal
        {...bersamaProps}
        me="u-f"
        data={data(keluar, false, { accounts: [BERSAMA_ACCOUNT] })}
        labels={bLabels(keluar)}
      />,
    );
    expect(screen.getByText('Biaya').nextElementSibling?.textContent).toBe(formatRupiah(2_500));
    expect(container.textContent).not.toContain('BCA Pribadi');
    unmount();
    const masuk = kakiBersama({ direction: 'in' });
    render(
      <DetailReal
        {...bersamaProps}
        me="u-f"
        data={data(masuk, false, { accounts: [BERSAMA_ACCOUNT] })}
        labels={bLabels(masuk)}
      />,
    );
    expect(screen.queryByText('Biaya')).toBeNull();
  });

  it('kaki Bersama oleh pencatat: Batalkan + catatan tidak bisa diubah', () => {
    const e = kakiBersama();
    render(
      <DetailReal
        {...bersamaProps}
        me="u-n"
        data={data(e, false, { accounts: [BERSAMA_ACCOUNT] })}
        labels={bLabels(e)}
      />,
    );
    expect(screen.getByRole('button', { name: 'Batalkan transaksi' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
    expect(screen.getByText('Transfer tidak bisa diubah. Batalkan, lalu catat lagi.')).toBeTruthy();
  });

  it('kaki Pribadi: Setor ke Bersama, Pribadi → Bersama, keterangan Pribadi tampil', () => {
    const e = entry({
      kind: 'space_transfer',
      spaceKind: 'personal',
      direction: 'out',
      description: 'bayar kos adik',
      categoryName: undefined as never,
    });
    render(
      <DetailReal
        {...props}
        me="u-n"
        data={data(e)}
        labels={{
          title: entryTitleVM(e),
          category: 'Antar ruang',
          amount: { value: -25_000, kind: 'neutral' },
        }}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Setor ke Bersama' })).toBeTruthy();
    expect(screen.getByText('→')).toBeTruthy();
    expect(screen.getByText('dari Pribadi ke Bersama').className).toContain('sr-only');
    expect(screen.getByText('Catatan').nextElementSibling?.textContent).toBe('bayar kos adik');
    expect(screen.getByText('BCA')).toBeTruthy();
  });

  it('kaki Pribadi dengan keterangan pribadi dan catatan Bersama berbeda: menampilkan Catatan pribadi & Catatan Bersama (K1)', () => {
    const e = entry({
      kind: 'space_transfer',
      spaceKind: 'personal',
      direction: 'out',
      description: 'bayar kos adik',
      sharedNote: 'Setoran bulanan rumah',
      categoryName: undefined as never,
    });
    render(
      <DetailReal
        {...props}
        me="u-n"
        data={data(e)}
        labels={{
          title: entryTitleVM(e),
          category: 'Antar ruang',
          amount: { value: -25_000, kind: 'neutral' },
        }}
      />,
    );
    expect(screen.getByText('Catatan pribadi').nextElementSibling?.textContent).toBe(
      'bayar kos adik',
    );
    expect(screen.getByText('Catatan Bersama').nextElementSibling?.textContent).toBe(
      'Setoran bulanan rumah',
    );
  });
});

describe('DetailReal Pindahkan (S7-D2)', () => {
  it('tombol bernama ruang tujuan; bukan pencatat atau Kantor: tidak dirender', () => {
    const { unmount } = render(
      <DetailReal {...props} me="u-n" data={data(entry())} labels={labels} />,
    );
    expect(screen.getByRole('button', { name: 'Pindahkan ke bersama' })).toBeTruthy();
    unmount();
    render(<DetailReal {...props} me="u-f" data={data(entry())} labels={labels} />);
    expect(screen.queryByRole('button', { name: /Pindahkan/ })).toBeNull();
  });

  it('entri asal yang sudah dipindah: banner + Buka di {tujuan}, tanpa Pulihkan, nominal dipindahkan', () => {
    const moved = entry({
      voidedAt: '2026-11-02T09:00:00+07:00',
      movedAt: '2026-11-02T09:00:00+07:00',
    });
    const { container } = render(
      <DetailReal {...props} me="u-n" data={data(moved)} labels={labels} />,
    );
    expect(screen.getByText('Transaksi ini sudah dipindahkan ke Bersama.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Buka di Bersama' }).getAttribute('href')).toBe(
      '/bersama/transaksi',
    );
    expect(screen.queryByRole('button', { name: 'Pulihkan' })).toBeNull();
    expect(screen.queryByText('Transaksi ini sudah dibatalkan.')).toBeNull();
    expect(container.querySelector('.line-through')).not.toBeNull();
    expect(screen.getByText('dipindahkan').className).toContain('sr-only');
  });
});

describe('DetailReal talangan (S7-D3)', () => {
  const talanganEntry = () => entry({ reimbursable: true });
  const menunggu: TalanganVM = { items: [], reimbursed: 0, remaining: 25_000 };
  const sebagian: TalanganVM = {
    items: [
      { id: 'r1', occurredOn: '2026-11-01', amount: 5_000 },
      { id: 'r2', occurredOn: '2026-11-02', amount: 5_000 },
    ],
    reimbursed: 10_000,
    remaining: 15_000,
  };
  const lunas: TalanganVM = {
    items: [{ id: 'r1', occurredOn: '2026-11-01', amount: 25_000 }],
    reimbursed: 25_000,
    remaining: 0,
  };

  it('menunggu: status, Talangan Ya kantor, Catat reimburse + Tidak diganti, Batalkan tetap ada', () => {
    render(
      <DetailReal
        {...props}
        me="u-n"
        data={data(talanganEntry(), false, { talangan: menunggu })}
        labels={labels}
      />,
    );
    expect(screen.getByText(/Menunggu reimburse · sisa/).textContent).toMatch(
      /^Menunggu reimburse · sisa Rp\s?25\.000$/,
    );
    expect(screen.getByText('Ya, kantor')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Catat reimburse' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tidak diganti' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Batalkan transaksi' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Pindahkan/ })).toBeNull();
  });

  it('sebagian: sisa dari total, daftar reimburse bertautan, Batalkan diganti keterangan', () => {
    render(
      <DetailReal
        {...props}
        me="u-n"
        data={data(talanganEntry(), false, { talangan: sebagian })}
        labels={labels}
      />,
    );
    expect(screen.getByText(/sisa .* dari /).textContent).toMatch(
      /sisa Rp\s?15\.000 dari Rp\s?25\.000/,
    );
    const list = screen.getByRole('list', { name: 'Reimburse untuk talangan ini' });
    const links = list.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('/pribadi/transaksi/r1');
    expect(screen.queryByRole('button', { name: 'Batalkan transaksi' })).toBeNull();
    expect(
      screen.getByText('Batalkan reimburse di atas dulu untuk membatalkan talangan ini.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Catat reimburse' })).toBeTruthy();
  });

  it('lunas: Sudah diganti penuh, tanpa Catat reimburse dan Tidak diganti', () => {
    render(
      <DetailReal
        {...props}
        me="u-n"
        data={data(talanganEntry(), false, { talangan: lunas })}
        labels={labels}
      />,
    );
    expect(screen.getByText('Sudah diganti penuh')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Catat reimburse' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tidak diganti' })).toBeNull();
  });

  it('Detail reimburse: tautan Lihat talangan ke induknya, bisa Batalkan, tanpa Ubah', () => {
    const r = entry({
      id: 'r1',
      kind: 'reimbursement',
      reimbursesEntryId: 't1',
      description: undefined as never,
    });
    render(
      <DetailReal
        {...props}
        me="u-n"
        data={data(r)}
        labels={{
          title: 'Reimburse talangan',
          category: 'Reimburse',
          amount: { value: 25_000, kind: 'neutral' },
        }}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Reimburse talangan' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lihat talangan' }).getAttribute('href')).toBe(
      '/pribadi/transaksi/t1',
    );
    expect(screen.getByRole('button', { name: 'Batalkan transaksi' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  });
});

describe('ronde perbaikan 1', () => {
  it('entri asal dipindah, dilihat bukan pencatat: nama pencatat, tanpa tautan', () => {
    const moved = entry({
      voidedAt: '2026-11-02T09:00:00+07:00',
      movedAt: '2026-11-02T09:00:00+07:00',
    });
    render(<DetailReal {...props} me="u-f" data={data(moved)} labels={labels} />);
    expect(screen.getByText('Novanda memindahkan transaksi ini ke ruang lain.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Buka di/ })).toBeNull();
  });

  it('Tidak diganti hanya bila belum ada reimburse hidup', () => {
    const t = entry({ reimbursable: true });
    const sebagian = {
      items: [{ id: 'r1', occurredOn: TODAY, amount: 5_000 }],
      reimbursed: 5_000,
      remaining: 20_000,
    };
    render(
      <DetailReal
        {...props}
        me="u-n"
        data={data(t, false, { talangan: sebagian })}
        labels={labels}
      />,
    );
    expect(screen.getByRole('button', { name: 'Catat reimburse' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tidak diganti' })).toBeNull();
  });

  it('kaki Pribadi antar ruang: baris Biaya bila ada', () => {
    const e = entry({
      kind: 'space_transfer',
      spaceKind: 'personal',
      direction: 'out',
      fee: 6_500,
      categoryName: undefined as never,
    });
    render(
      <DetailReal
        {...props}
        me="u-n"
        data={data(e)}
        labels={{
          title: 'Setor ke Bersama',
          category: 'Antar ruang',
          amount: { value: -25_000, kind: 'neutral' },
        }}
      />,
    );
    expect(screen.getByText('Biaya')).toBeTruthy();
  });
});

describe('Detail saldo awal (S7-W2)', () => {
  const open = entry({
    kind: 'opening_balance',
    categoryName: undefined as never,
    description: undefined as never,
    amount: 1_000_000,
  });
  const oplabels = {
    title: 'Saldo awal',
    category: 'Saldo awal',
    amount: { value: 1_000_000, kind: 'neutral' as const },
  };

  it('terkunci (> 7 hari): baris Saldo awal terkunci sejak {tanggal}, tanpa Ubah', () => {
    render(
      <DetailReal {...props} today="2026-11-20" me="u-n" data={data(open)} labels={oplabels} />,
    );
    // Dompet dibuka 28 Okt: 7 hari penuh berakhir 4 Nov, terkunci sejak 5 Nov.
    expect(
      screen.getByText('Saldo awal terkunci sejak 5 Nov. Pakai Cocokkan saldo untuk menyesuaikan.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  });

  it('masih bisa diubah: Ubah ada, tanpa baris terkunci', () => {
    render(<DetailReal {...props} me="u-n" data={data(open)} labels={oplabels} />);
    expect(screen.getByRole('button', { name: 'Ubah' })).toBeTruthy();
    expect(screen.queryByText(/terkunci sejak/)).toBeNull();
  });

  it('saldo awal yang dibatalkan atau dompet tak ditemukan: tanpa baris terkunci', () => {
    render(
      <DetailReal
        {...props}
        today="2026-11-20"
        me="u-n"
        data={data(open, false, { accounts: [] })}
        labels={oplabels}
      />,
    );
    expect(screen.queryByText(/terkunci sejak/)).toBeNull();
  });
});
