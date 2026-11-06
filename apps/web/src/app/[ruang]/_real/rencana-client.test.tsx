import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetOverviewVM } from '@/features/rencana/types';
import {
  BudgetRowTrigger,
  CopyBudgetsButton,
  CopyConflictNote,
  RencanaHost,
  SetBudgetButton,
} from './rencana-client';

afterEach(cleanup);

const actions = vi.hoisted(() => ({
  setBudgetAction: vi.fn(),
  deleteBudgetAction: vi.fn(),
  copyBudgetsAction: vi.fn(),
}));
vi.mock('../_actions/rencana', () => actions);
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

describe('CopyBudgetsButton (K13)', () => {
  it('menyalin ke bulan label ini; toast menyebut jumlah, ruang, dan yang dilewati', async () => {
    const user = userEvent.setup();
    actions.copyBudgetsAction.mockResolvedValueOnce({
      ok: true,
      value: { copied: 3, skippedExisting: 0, skippedConflict: 1, skippedArchived: 1 },
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
      value: { copied: 0, skippedExisting: 2, skippedConflict: 0, skippedArchived: 0 },
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
      value: { copied: 1, skippedExisting: 0, skippedConflict: 0, skippedArchived: 0 },
    });
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalled();
    });
  });
});
