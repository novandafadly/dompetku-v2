import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetOverviewVM } from '@/features/rencana/types';
import {
  BudgetRowTrigger,
  CopyBudgetsButton,
  CopyConflictNote,
  AddBillButton,
  BillBodyTrigger,
  PayButton,
  RencanaHost,
  SetBudgetButton,
  UnskipButton,
  type BillHostData,
} from './rencana-client';

afterEach(cleanup);

const actions = vi.hoisted(() => ({
  setBudgetAction: vi.fn(),
  deleteBudgetAction: vi.fn(),
  copyBudgetsAction: vi.fn(),
  createBillAction: vi.fn(),
  updateBillAction: vi.fn(),
  archiveBillAction: vi.fn(),
  payBillAction: vi.fn(),
  skipBillAction: vi.fn(),
  unskipBillAction: vi.fn(),
}));
vi.mock('../_actions/rencana', () => actions);
const entri = vi.hoisted(() => ({ voidEntryAction: vi.fn() }));
vi.mock('../_actions/entri', () => entri);
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ toast: toastSpy }));

beforeEach(() => {
  actions.setBudgetAction.mockResolvedValue({ ok: true, value: undefined });
  actions.deleteBudgetAction.mockResolvedValue({ ok: true, value: undefined });
});

const row = (over: Partial<BudgetOverviewVM> & Pick<BudgetOverviewVM, 'categoryId' | 'name'>) =>
  ({
    icon: 'Tag',
    budget: null,
    wajib: false,
    spent: 0,
    pct: null,
    remaining: null,
    archived: false,
    parentId: null,
    subAllocated: null,
    maxAmount: null,
    ...over,
  }) satisfies BudgetOverviewVM;

const ROWS = [
  row({ categoryId: 'k-internet', name: 'Internet' }),
  row({
    categoryId: 'k-sewa',
    name: 'Sewa Rumah',
    budget: 2_500_000,
    wajib: true,
    spent: 0,
    pct: 0,
    remaining: 2_500_000,
  }),
];

function setup(ruang: 'pribadi' | 'bersama' = 'pribadi') {
  render(
    <RencanaHost
      ruang={ruang}
      month="2026-11"
      range="23 Okt – 24 Nov"
      rows={ROWS}
      previous={{}}
      billNameByRoot={{}}
    >
      <BudgetRowTrigger categoryId="k-internet" className="flex">
        Baris Internet
      </BudgetRowTrigger>
      <BudgetRowTrigger categoryId="k-sewa" className="flex">
        Baris Sewa
      </BudgetRowTrigger>
      <SetBudgetButton label="Atur anggaran" variant="secondary" />
      <CopyBudgetsButton />
      <CopyConflictNote />
    </RencanaHost>,
  );
}

// Paling awal: timer restoreFocus tes lain (300/900 ms) tidak boleh bocor ke tes fokus ini.
describe('fokus sesudah perubahan (I2)', () => {
  /** Pemicu benar-benar lepas saat simpan berhasil (daftar dimuat ulang): tanpa restoreFocus fokus jatuh ke <body>. */
  function Harness({ withRow }: { withRow: boolean }) {
    const [gone, setGone] = useState(false);
    actions.setBudgetAction.mockImplementation(() => {
      setGone(true);
      return Promise.resolve({ ok: true, value: undefined });
    });
    return (
      <RencanaHost
        ruang="pribadi"
        month="2026-11"
        range="23 Okt – 24 Nov"
        rows={ROWS}
        previous={{}}
        billNameByRoot={{}}
      >
        <h1>Rencana</h1>
        {gone ? null : <SetBudgetButton label="Atur anggaran pertama" variant="primary" />}
        {withRow ? (
          <BudgetRowTrigger categoryId="k-internet" className="flex">
            Baris Internet
          </BudgetRowTrigger>
        ) : null}
      </RencanaHost>
    );
  }

  async function saveFromEmpty(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Atur anggaran pertama' }));
    await user.type(await screen.findByRole('textbox', { name: 'Anggaran periode ini' }), '100');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kategori' }), 'k-internet');
    await user.click(screen.getByRole('button', { name: 'Simpan anggaran' }));
  }

  it('pemicu lepas dan baris kategori ada: fokus ke baris', async () => {
    const user = userEvent.setup();
    render(<Harness withRow />);
    await saveFromEmpty(user);
    await waitFor(
      () => {
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Baris Internet' }));
      },
      { timeout: 3000 },
    );
  });
});

describe('RencanaHost: sheet Anggaran', () => {
  it('sheet tidak dipasang sebelum dibuka; baris Belum dianggarkan membuka sheet dengan kategorinya', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Baris Internet' }));
    expect(await screen.findByRole('combobox', { name: 'Kategori' })).toHaveValue('k-internet');
  });

  it('simpan memanggil setBudgetAction dengan ruang, bulan label, dan isian', async () => {
    const user = userEvent.setup();
    setup('bersama');
    await user.click(screen.getByRole('button', { name: 'Baris Internet' }));
    await user.type(await screen.findByRole('textbox', { name: 'Anggaran periode ini' }), '350000');
    await user.click(screen.getByRole('switch', { name: 'Wajib' }));
    await user.click(screen.getByRole('button', { name: 'Simpan anggaran' }));
    await waitFor(() => {
      expect(actions.setBudgetAction).toHaveBeenCalledWith('bersama', {
        categoryId: 'k-internet',
        amount: 350_000,
        wajib: true,
        month: '2026-11',
      });
    });
    expect(toastSpy).toHaveBeenCalledWith({ message: 'Anggaran Internet disimpan · Bersama' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('galat kode dari action diteruskan ke sheet; action yang melempar = jaringan', async () => {
    const user = userEvent.setup();
    setup();
    actions.setBudgetAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'obligation_double' },
    });
    await user.click(screen.getByRole('button', { name: 'Baris Internet' }));
    await user.type(await screen.findByRole('textbox', { name: 'Anggaran periode ini' }), '100');
    await user.click(screen.getByRole('button', { name: 'Simpan anggaran' }));
    expect(await screen.findByText(/^Kategori ini sudah punya tagihan\./)).toBeTruthy();
    actions.setBudgetAction.mockRejectedValueOnce(new Error('putus'));
    await user.click(screen.getByRole('button', { name: 'Simpan anggaran' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Koneksi terputus');
  });

  it('baris yang sudah dianggarkan: ubah terkunci; hapus memanggil deleteBudgetAction', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Baris Sewa' }));
    await user.click(await screen.findByRole('button', { name: 'Hapus anggaran' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Hapus anggaran' }));
    await waitFor(() => {
      expect(actions.deleteBudgetAction).toHaveBeenCalledWith('pribadi', {
        categoryId: 'k-sewa',
        month: '2026-11',
      });
    });
    expect(toastSpy).toHaveBeenCalledWith({ message: 'Anggaran Sewa Rumah dihapus · Pribadi' });
  });

  it('Atur anggaran membuka sheet kosong', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Atur anggaran' }));
    expect(await screen.findByRole('combobox', { name: 'Kategori' })).toHaveValue('');
  });
});

describe('catatan bentrok (M7)', () => {
  it('hilang sesudah atur anggaran berikutnya', async () => {
    const user = userEvent.setup();
    actions.copyBudgetsAction.mockResolvedValueOnce({
      ok: true,
      value: {
        copied: 1,
        skippedExisting: 0,
        skippedConflict: 2,
        skippedArchived: 0,
        skippedParent: 0,
      },
    });
    setup();
    await user.click(screen.getByRole('button', { name: 'Salin anggaran periode lalu' }));
    expect(await screen.findByText(/2 anggaran wajib tidak disalin/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Baris Internet' }));
    await user.type(await screen.findByRole('textbox', { name: 'Anggaran periode ini' }), '100');
    await user.click(screen.getByRole('button', { name: 'Simpan anggaran' }));
    await waitFor(() => {
      expect(screen.queryByText(/anggaran wajib tidak disalin/)).toBeNull();
    });
  });
});

describe('CopyBudgetsButton (K13)', () => {
  it('menyalin ke bulan label ini; toast menyebut jumlah, ruang, dan yang dilewati', async () => {
    const user = userEvent.setup();
    actions.copyBudgetsAction.mockResolvedValueOnce({
      ok: true,
      value: {
        copied: 3,
        skippedExisting: 0,
        skippedConflict: 1,
        skippedArchived: 1,
        skippedParent: 0,
      },
    });
    setup();
    await user.click(screen.getByRole('button', { name: 'Salin anggaran periode lalu' }));
    await waitFor(() => {
      expect(actions.copyBudgetsAction).toHaveBeenCalledWith('pribadi', { toMonth: '2026-11' });
    });
    expect(toastSpy).toHaveBeenCalledWith({
      message: '3 anggaran disalin ke Pribadi · 2 dilewati',
    });
    expect(
      await screen.findByText(
        '1 anggaran wajib tidak disalin karena kategorinya sudah punya tagihan.',
      ),
    ).toBeTruthy();
  });

  it('tanpa bentrok tagihan: tidak ada catatan; tidak ada yang tersalin: toast jujur', async () => {
    const user = userEvent.setup();
    actions.copyBudgetsAction.mockResolvedValueOnce({
      ok: true,
      value: {
        copied: 0,
        skippedExisting: 2,
        skippedConflict: 0,
        skippedArchived: 0,
        skippedParent: 0,
      },
    });
    setup('bersama');
    await user.click(screen.getByRole('button', { name: 'Salin anggaran periode lalu' }));
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith({
        message: 'Tidak ada anggaran yang disalin ke Bersama',
      });
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('galat: pesan di bawah tombol, tombol bisa dicoba lagi', async () => {
    const user = userEvent.setup();
    actions.copyBudgetsAction.mockRejectedValueOnce(new Error('putus'));
    setup();
    await user.click(screen.getByRole('button', { name: 'Salin anggaran periode lalu' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Belum tersalin. Koneksi terputus',
    );
    actions.copyBudgetsAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'unknown' },
    });
    await user.click(screen.getByRole('button', { name: 'Salin anggaran periode lalu' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Ada kendala di server');
    });
  });

  it('klik ganda saat berjalan hanya mengirim sekali', async () => {
    const user = userEvent.setup();
    let resolve: (v: unknown) => void = () => undefined;
    actions.copyBudgetsAction.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    setup();
    const btn = screen.getByRole('button', { name: 'Salin anggaran periode lalu' });
    await user.click(btn);
    await user.click(btn);
    expect(actions.copyBudgetsAction).toHaveBeenCalledTimes(1);
    resolve({
      ok: true,
      value: {
        copied: 1,
        skippedExisting: 0,
        skippedConflict: 0,
        skippedArchived: 0,
        skippedParent: 0,
      },
    });
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalled();
    });
  });
});

describe('RencanaHost: Tagihan', () => {
  const BILL: BillHostData['bills'][number] = {
    billId: 'b1',
    name: 'Listrik PLN',
    amount: 485_000,
    categoryId: 'k-listrik',
    categoryName: 'Listrik & Air',
    rootCategoryId: 'k-listrik',
    accountId: 'a1',
    accountName: 'BCA',
    dayOfMonth: 10,
    startsOn: '2026-01-01',
    endsOn: null,
    archived: false,
    nextDueOn: '2026-11-10',
    nextOccurrenceId: 'o1',
  };
  const DATA: BillHostData = {
    bills: [BILL],
    occurrences: [
      {
        occurrenceId: 'o1',
        billId: 'b1',
        name: 'Listrik PLN',
        amount: 485_000,
        dueOn: '2026-11-10',
        daysUntil: 4,
        overdue: false,
        posted: false,
        skipped: false,
        entryId: null,
        paidOn: null,
      },
    ],
    accounts: [
      {
        id: 'a1',
        name: 'BCA',
        pocket: 'operasional',
        walletType: 'bank',
        openedOn: '2026-01-01',
        archived: false,
        balance: 2_000_000,
      },
    ],
    categories: [
      {
        id: 'k-listrik',
        parentId: null,
        name: 'Listrik & Air',
        type: 'expense',
        icon: 'Tag',
        archived: false,
      },
    ],
    today: '2026-11-06',
    wajibRoots: {},
  };

  function setupBill() {
    render(
      <RencanaHost
        ruang="pribadi"
        month="2026-11"
        range="23 Okt – 24 Nov"
        rows={[]}
        previous={{}}
        billNameByRoot={{}}
        bill={DATA}
      >
        <h1>Rencana</h1>
        <BillBodyTrigger billId="b1" className="flex">
          Baris Listrik
        </BillBodyTrigger>
        <PayButton occurrenceId="o1" billName="Listrik PLN" amountText="Rp 485.000" />
        <UnskipButton occurrenceId="o1" billName="Listrik PLN" />
        <AddBillButton label="Tambah tagihan" variant="primary" />
      </RencanaHost>,
    );
  }

  beforeEach(() => {
    toastSpy.mockClear();
    actions.payBillAction.mockResolvedValue({
      ok: true,
      value: { entryId: 'e1', occurrenceId: 'o1', version: 1, replayed: false, warnings: [] },
    });
    actions.skipBillAction.mockResolvedValue({ ok: true, value: { skipped: true } });
    actions.unskipBillAction.mockResolvedValue({ ok: true, value: { skipped: false } });
    actions.createBillAction.mockResolvedValue({ ok: true, value: { billId: 'b9' } });
    actions.archiveBillAction.mockResolvedValue({ ok: true, value: { billId: 'b1' } });
    entri.voidEntryAction.mockResolvedValue({ ok: true, value: { version: 2 } });
  });

  it('Bayar: nama aksesibel memuat nominal; nominal beda dikirim, toast + Urungkan membatalkan entri', async () => {
    const user = userEvent.setup();
    setupBill();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Bayar Listrik PLN, Rp 485.000' }));
    const nominal = await screen.findByRole('textbox', { name: 'Nominal' });
    expect(nominal).toHaveValue('485.000');
    await user.clear(nominal);
    await user.type(nominal, '512000');
    await user.click(screen.getByRole('button', { name: /^Bayar Rp\s512\.000$/ }));
    await waitFor(() => {
      expect(actions.payBillAction).toHaveBeenCalledTimes(1);
    });
    expect(actions.payBillAction).toHaveBeenCalledWith(
      'pribadi',
      expect.objectContaining({
        occurrenceId: 'o1',
        accountId: 'a1',
        amount: 512_000,
        occurredOn: '2026-11-06',
        allowNegative: false,
        clientId: expect.any(String) as string,
      }),
    );
    const t = toastSpy.mock.calls.at(-1)?.[0] as {
      message: string;
      action: { onAction: () => void };
    };
    expect(t.message).toMatch(/^Tagihan Listrik PLN dibayar di Pribadi · Rp\s512\.000 dari BCA$/);
    t.action.onAction();
    t.action.onAction(); // klik ganda: satu permintaan
    await waitFor(() => {
      expect(entri.voidEntryAction).toHaveBeenCalledTimes(1);
    });
    expect(entri.voidEntryAction).toHaveBeenCalledWith('pribadi', {
      clientId: expect.any(String) as string,
      entryId: 'e1',
      expectedVersion: 1,
    });
  });

  it('klik ganda Bayar = satu permintaan (clientId sama)', async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => undefined;
    actions.payBillAction.mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    );
    setupBill();
    await user.click(screen.getByRole('button', { name: /^Bayar Listrik PLN/ }));
    const pay = await screen.findByRole('button', { name: /^Bayar Rp\s485\.000$/ });
    await user.dblClick(pay);
    expect(actions.payBillAction).toHaveBeenCalledTimes(1);
    release({
      ok: true,
      value: { entryId: 'e1', occurrenceId: 'o1', version: 1, replayed: false, warnings: [] },
    });
  });

  it('saldo kurang: peringatan tanpa galat, tombol jadi Tetap bayar dan mengirim allowNegative', async () => {
    const user = userEvent.setup();
    actions.payBillAction.mockResolvedValueOnce({ ok: false, error: { code: 'saldo_negatif' } });
    setupBill();
    await user.click(screen.getByRole('button', { name: /^Bayar Listrik PLN/ }));
    await user.click(await screen.findByRole('button', { name: /^Bayar Rp\s485\.000$/ }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Saldo BCA tinggal Rp\s2\.000\.000\. Kalau dibayar, saldonya jadi Rp\s1\.515\.000\./,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tetap bayar' }));
    await waitFor(() => {
      expect(actions.payBillAction).toHaveBeenCalledTimes(2);
    });
    expect(actions.payBillAction.mock.calls[1]?.[1]).toMatchObject({ allowNegative: true });
    const ids = actions.payBillAction.mock.calls.map(
      (c) => (c[1] as { clientId: string }).clientId,
    );
    expect(ids[1]).toBe(ids[0]);
  });

  it('already_posted: kotak galat tanpa nominal, Muat ulang menutup sheet dan refresh', async () => {
    const user = userEvent.setup();
    actions.payBillAction.mockResolvedValueOnce({ ok: false, error: { code: 'already_posted' } });
    setupBill();
    await user.click(screen.getByRole('button', { name: /^Bayar Listrik PLN/ }));
    await user.click(await screen.findByRole('button', { name: /^Bayar Rp\s485\.000$/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Tagihan ini sudah dibayar.');
    expect(alert.textContent).not.toMatch(/Rp/);
    await user.click(within(alert).getByRole('button', { name: 'Muat ulang' }));
    expect(refresh).toHaveBeenCalled();
  });

  it.each([
    ['not_found', 'Tagihan ini sudah tidak ada.'],
    ['bill_archived', 'Tagihan ini sudah diarsipkan.'],
  ])('Bayar %s: salinan tanpa nominal + Muat ulang (refresh)', async (code, text) => {
    const user = userEvent.setup();
    actions.payBillAction.mockResolvedValueOnce({ ok: false, error: { code } });
    setupBill();
    await user.click(screen.getByRole('button', { name: /^Bayar Listrik PLN/ }));
    await user.click(await screen.findByRole('button', { name: /^Bayar Rp\s485\.000$/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(text);
    expect(alert.textContent).not.toMatch(/Rp/);
    await user.click(within(alert).getByRole('button', { name: 'Muat ulang' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('Lewati tagihan ini memanggil skip; toast Urungkan memanggil unskip', async () => {
    const user = userEvent.setup();
    setupBill();
    await user.click(screen.getByRole('button', { name: /^Bayar Listrik PLN/ }));
    await user.click(await screen.findByRole('button', { name: 'Lewati tagihan ini' }));
    await waitFor(() => {
      expect(actions.skipBillAction).toHaveBeenCalledWith('pribadi', 'o1');
    });
    const t = toastSpy.mock.calls.at(-1)?.[0] as {
      message: string;
      action: { onAction: () => void };
    };
    expect(t.message).toBe('Listrik PLN dilewati · Pribadi');
    t.action.onAction();
    await waitFor(() => {
      expect(actions.unskipBillAction).toHaveBeenCalledWith('pribadi', 'o1');
    });
  });

  it('Batalkan lewati memanggil unskip dan memberi toast', async () => {
    const user = userEvent.setup();
    setupBill();
    await user.click(screen.getByRole('button', { name: 'Batalkan lewati Listrik PLN' }));
    await waitFor(() => {
      expect(actions.unskipBillAction).toHaveBeenCalledWith('pribadi', 'o1');
    });
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith({ message: 'Listrik PLN kembali ditagih · Pribadi' });
    });
  });

  it('Tambah tagihan: validasi nama, simpan memanggil createBillAction dengan clientId', async () => {
    const user = userEvent.setup();
    setupBill();
    await user.click(screen.getByRole('button', { name: 'Tambah tagihan' }));
    // Judul menyebut aksi (S9-C7), sejajar dengan `Ubah tagihan`.
    expect(await screen.findByRole('dialog', { name: /^Tambah tagihan\s*Pribadi$/ })).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: 'Simpan tagihan' }));
    expect(
      await screen.findByText('Nama tagihan wajib diisi, paling banyak 60 huruf.'),
    ).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Nama' }), 'Internet');
    await user.type(screen.getByRole('textbox', { name: 'Perkiraan nominal' }), '300000');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kategori' }), 'k-listrik');
    await user.click(screen.getByRole('button', { name: 'Simpan tagihan' }));
    await waitFor(() => {
      expect(actions.createBillAction).toHaveBeenCalledTimes(1);
    });
    expect(actions.createBillAction).toHaveBeenCalledWith(
      'pribadi',
      expect.objectContaining({
        name: 'Internet',
        amount: 300_000,
        categoryId: 'k-listrik',
        dayOfMonth: 1,
        startsOn: '2026-11-06',
        endsOn: null,
        accountId: null,
        clientId: expect.any(String) as string,
      }),
    );
  });

  it('obligation_double di Tagihan: galat di kolom Kategori dengan jalan keluar, fokus ke Kategori', async () => {
    const user = userEvent.setup();
    actions.createBillAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'obligation_double' },
    });
    setupBill();
    await user.click(screen.getByRole('button', { name: 'Tambah tagihan' }));
    await user.type(await screen.findByRole('textbox', { name: 'Nama' }), 'Listrik');
    await user.type(screen.getByRole('textbox', { name: 'Perkiraan nominal' }), '1000');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kategori' }), 'k-listrik');
    await user.click(screen.getByRole('button', { name: 'Simpan tagihan' }));
    expect(
      await screen.findByText(/Kategori Listrik & Air sudah punya anggaran wajib\. Satu kewajiban/),
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Kategori' })).toHaveFocus();
  });

  it('Ubah: nominal diganti memanggil updateBillAction; Arsipkan lewat dialog (fokus awal Kembali)', async () => {
    const user = userEvent.setup();
    setupBill();
    await user.click(screen.getByRole('button', { name: 'Baris Listrik' }));
    const nominal = await screen.findByRole('textbox', { name: 'Perkiraan nominal' });
    expect(nominal).toHaveFocus();
    expect(
      screen.getByText('Berlaku untuk tagihan yang belum dibayar mulai hari ini.'),
    ).toBeTruthy();
    await user.clear(nominal);
    await user.type(nominal, '500000');
    await user.click(screen.getByRole('button', { name: 'Simpan tagihan' }));
    await waitFor(() => {
      expect(actions.updateBillAction).toHaveBeenCalledWith(
        'pribadi',
        expect.objectContaining({ billId: 'b1', amount: 500_000, accountId: 'a1' }),
      );
    });
  });

  it('bill_account_kantor: galat kolom Dompet dengan jalan keluar, fokus ke Dompet', async () => {
    const user = userEvent.setup();
    actions.createBillAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'bill_account_kantor' },
    });
    setupBill();
    await user.click(screen.getByRole('button', { name: 'Tambah tagihan' }));
    await user.type(await screen.findByRole('textbox', { name: 'Nama' }), 'Internet');
    await user.type(screen.getByRole('textbox', { name: 'Perkiraan nominal' }), '1000');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kategori' }), 'k-listrik');
    await user.click(screen.getByRole('button', { name: 'Simpan tagihan' }));
    expect(
      await screen.findByText('Dompet Kantor tidak bisa dipakai untuk tagihan. Pilih dompet lain.'),
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Dompet bayar bawaan' })).toHaveFocus();
  });

  it('clientId Bayar berputar per pembukaan sheet (sukses lalu buka lagi; buka, tutup, buka lagi)', async () => {
    const user = userEvent.setup();
    setupBill();
    const ids = () =>
      actions.payBillAction.mock.calls.map((c) => (c[1] as { clientId: string }).clientId);
    await user.click(screen.getByRole('button', { name: /^Bayar Listrik PLN/ }));
    await user.click(await screen.findByRole('button', { name: /^Bayar Rp\s485\.000$/ }));
    await waitFor(() => {
      expect(ids()).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await user.click(screen.getByRole('button', { name: /^Bayar Listrik PLN/ }));
    await user.click(await screen.findByRole('button', { name: /^Bayar Rp\s485\.000$/ }));
    await waitFor(() => {
      expect(ids()).toHaveLength(2);
    });
    expect(ids()[1]).not.toBe(ids()[0]);
    // buka, tutup tanpa bayar, buka lagi: gagal bayar dua kali dari sheet berbeda tetap berbeda.
    actions.payBillAction.mockResolvedValue({ ok: false, error: { code: 'network' } });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await user.click(screen.getByRole('button', { name: /^Bayar Listrik PLN/ }));
    await user.click(await screen.findByRole('button', { name: /^Bayar Rp\s485\.000$/ }));
    await waitFor(() => {
      expect(ids()).toHaveLength(3);
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await user.click(screen.getByRole('button', { name: /^Bayar Listrik PLN/ }));
    await user.click(await screen.findByRole('button', { name: /^Bayar Rp\s485\.000$/ }));
    await waitFor(() => {
      expect(ids()).toHaveLength(4);
    });
    expect(ids()[3]).not.toBe(ids()[2]);
    // "Coba lagi" di sheet yang sama memakai clientId yang sama.
    await user.click(await screen.findByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => {
      expect(ids()).toHaveLength(5);
    });
    expect(ids()[4]).toBe(ids()[3]);
  });

  it('peringatan saldo kurang hilang saat nominal atau dompet diganti', async () => {
    const user = userEvent.setup();
    actions.payBillAction.mockResolvedValue({ ok: false, error: { code: 'saldo_negatif' } });
    setupBill();
    await user.click(screen.getByRole('button', { name: /^Bayar Listrik PLN/ }));
    await user.click(await screen.findByRole('button', { name: /^Bayar Rp\s485\.000$/ }));
    expect(await screen.findByRole('status')).toBeTruthy();
    const nominal = screen.getByRole('textbox', { name: 'Nominal' });
    await user.clear(nominal);
    await user.type(nominal, '400000');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: /^Bayar Rp\s400\.000$/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Bayar Rp\s400\.000$/ }));
    expect(await screen.findByRole('status')).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dompet' }), 'a1');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('buka lagi sesudah ditutup: nominal dan peringatan saldo kembali awal (sesi baru)', async () => {
    const user = userEvent.setup();
    actions.payBillAction.mockResolvedValue({ ok: false, error: { code: 'saldo_negatif' } });
    setupBill();
    await user.click(screen.getByRole('button', { name: /^Bayar Listrik PLN/ }));
    const nominal = await screen.findByRole('textbox', { name: 'Nominal' });
    await user.clear(nominal);
    await user.type(nominal, '400000');
    await user.click(screen.getByRole('button', { name: /^Bayar Rp\s400\.000$/ }));
    expect(await screen.findByRole('status')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await user.click(screen.getByRole('button', { name: /^Bayar Listrik PLN/ }));
    expect(await screen.findByRole('textbox', { name: 'Nominal' })).toHaveValue('485.000');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: /^Bayar Rp\s485\.000$/ })).toBeTruthy();
  });

  it('nominal terlalu besar: salinan sendiri, bukan "lebih dari nol"', async () => {
    const user = userEvent.setup();
    setupBill();
    await user.click(screen.getByRole('button', { name: /^Bayar Listrik PLN/ }));
    const nominal = await screen.findByRole('textbox', { name: 'Nominal' });
    await user.clear(nominal);
    await user.type(nominal, '99999999999999');
    await user.click(screen.getByRole('button', { name: /^Bayar Rp/ }));
    expect(await screen.findByText(/Nominal terlalu besar/)).toBeTruthy();
    expect(actions.payBillAction).not.toHaveBeenCalled();
  });

  it('Ubah dengan not_found: salinan + Muat ulang (refresh)', async () => {
    const user = userEvent.setup();
    actions.updateBillAction.mockResolvedValueOnce({ ok: false, error: { code: 'not_found' } });
    setupBill();
    await user.click(screen.getByRole('button', { name: 'Baris Listrik' }));
    await user.click(await screen.findByRole('button', { name: 'Simpan tagihan' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Tagihan ini sudah tidak ada.');
    await user.click(within(alert).getByRole('button', { name: 'Muat ulang' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('Arsip not_found dan bill_archived dipetakan ke salinannya, bukan kendala server', async () => {
    const user = userEvent.setup();
    actions.archiveBillAction.mockResolvedValueOnce({ ok: false, error: { code: 'not_found' } });
    setupBill();
    await user.click(screen.getByRole('button', { name: 'Baris Listrik' }));
    await user.click(await screen.findByRole('button', { name: 'Arsipkan tagihan' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Arsipkan tagihan' }));
    expect(await within(dialog).findByText(/sudah tidak ada/)).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/kendala di server/);
    actions.archiveBillAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'bill_archived' },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Arsipkan tagihan' }));
    expect(await within(dialog).findByText(/sudah diarsipkan/)).toBeTruthy();
  });

  it('Ubah dengan dompet bawaan terarsip: keterangan, bukan kosong diam-diam', async () => {
    const user = userEvent.setup();
    render(
      <RencanaHost
        ruang="pribadi"
        month="2026-11"
        range="23 Okt – 24 Nov"
        rows={[]}
        previous={{}}
        billNameByRoot={{}}
        bill={{
          ...DATA,
          accounts: DATA.accounts.map((a) => ({ ...a, archived: true })),
        }}
      >
        <BillBodyTrigger billId="b1" className="flex">
          Baris Listrik
        </BillBodyTrigger>
      </RencanaHost>,
    );
    await user.click(screen.getByRole('button', { name: 'Baris Listrik' }));
    expect(
      await screen.findByText(
        'Dompet bawaan BCA sudah diarsipkan. Pilih dompet lain atau biarkan kosong.',
      ),
    ).toBeTruthy();
  });

  it('tanggal Mulai/Berakhir punya teks pasti (bukan format lokal browser)', async () => {
    const user = userEvent.setup();
    setupBill();
    await user.click(screen.getByRole('button', { name: 'Tambah tagihan' }));
    expect(await screen.findByText('6 Nov 2026')).toBeTruthy();
    expect(screen.getByText('Belum diisi')).toBeTruthy();
  });

  it('Arsipkan: dialog dengan fokus awal Kembali, konfirmasi memanggil archiveBillAction', async () => {
    const user = userEvent.setup();
    setupBill();
    await user.click(screen.getByRole('button', { name: 'Baris Listrik' }));
    await user.click(await screen.findByRole('button', { name: 'Arsipkan tagihan' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Arsipkan tagihan Listrik PLN?',
    });
    expect(within(dialog).getByRole('button', { name: 'Kembali' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Arsipkan tagihan' }));
    await waitFor(() => {
      expect(actions.archiveBillAction).toHaveBeenCalledWith('pribadi', 'b1');
    });
  });
});
