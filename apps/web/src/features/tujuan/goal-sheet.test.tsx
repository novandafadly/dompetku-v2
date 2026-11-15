import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { goal } from './__fixtures__/goal';
import {
  GoalSheet,
  type CreateGoalSubmit,
  type GoalSaveResult,
  type GoalSheetProps,
  type GoalWallet,
  type UpdateGoalSubmit,
} from './goal-sheet';

afterEach(cleanup);

const BCA: GoalWallet = { id: 'a1', name: 'Tabungan BCA', balance: 2_000_000 };
const KOSONG: GoalWallet = { id: 'a2', name: 'Tabungan Jago', balance: 0 };

function setup(over: Partial<GoalSheetProps> = {}, result: GoalSaveResult = { ok: true }) {
  const onCreate = vi.fn<(i: CreateGoalSubmit) => Promise<GoalSaveResult>>(() =>
    Promise.resolve(result),
  );
  const onUpdate = vi.fn<(i: UpdateGoalSubmit) => Promise<GoalSaveResult>>(() =>
    Promise.resolve(result),
  );
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <GoalSheet
      open
      onOpenChange={onOpenChange}
      ruang="pribadi"
      today="2026-11-15"
      goal={null}
      wallets={[BCA, KOSONG]}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onSaved={onSaved}
      {...over}
    />,
  );
  return { onCreate, onUpdate, onSaved, onOpenChange };
}

describe('GoalSheet: Tambah (S13-TJ4)', () => {
  it('judul memuat ruang; pemilih hanya dompet yang diberikan; kalimat saldo mengikuti pilihan', async () => {
    const user = userEvent.setup();
    setup({ ruang: 'bersama' });
    expect(await screen.findByRole('dialog', { name: /^Tambah tujuan\s*Bersama$/ })).toBeTruthy();
    const select = screen.getByRole('combobox', { name: 'Dompet tabungan' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Pilih dompet',
      'Tabungan BCA',
      'Tabungan Jago',
    ]);
    await user.selectOptions(select, 'a1');
    expect(
      screen.getByText(/Sudah ada Rp\s2\.000\.000 di Tabungan BCA\. Progres dimulai/),
    ).toBeTruthy();
    await user.selectOptions(select, 'a2');
    expect(
      screen.getByText('Tabungan Jago masih kosong. Isi lewat Transfer kapan saja.'),
    ).toBeTruthy();
    expect(screen.getByText(/Hanya dompet tabungan yang bisa punya tujuan/)).toBeTruthy();
  });

  it('satu dompet = terpilih otomatis, tanpa opsi kosong', async () => {
    setup({ wallets: [BCA] });
    expect(await screen.findByRole('combobox', { name: 'Dompet tabungan' })).toHaveValue('a1');
  });

  it('simpan: nilai valid, tanggal opsional dikirim, onSaved membawa nama', async () => {
    const user = userEvent.setup();
    const { onCreate, onSaved } = setup({ wallets: [BCA] });
    await user.type(await screen.findByRole('textbox', { name: /Nama tujuan/ }), '  Dana darurat ');
    await user.type(screen.getByRole('textbox', { name: /Target/ }), '10000000');
    await user.type(screen.getByLabelText(/Tanggal target/), '2027-03-25');
    await user.click(screen.getByRole('button', { name: 'Simpan tujuan' }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ name: 'Dana darurat', created: true });
    });
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      accountId: 'a1',
      name: 'Dana darurat',
      target: 10_000_000,
      targetOn: '2027-03-25',
    });
    expect(onCreate.mock.calls[0]?.[0].clientId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('tanpa tanggal: targetOn tidak dikirim', async () => {
    const user = userEvent.setup();
    const { onCreate } = setup({ wallets: [BCA] });
    await user.type(await screen.findByRole('textbox', { name: /Nama tujuan/ }), 'Liburan');
    await user.type(screen.getByRole('textbox', { name: /Target/ }), '5000000');
    await user.click(screen.getByRole('button', { name: 'Simpan tujuan' }));
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalled();
    });
    expect(onCreate.mock.calls[0]?.[0]).not.toHaveProperty('targetOn');
  });

  it('validasi di klien: nama kosong, target kosong; server tidak dipanggil', async () => {
    const user = userEvent.setup();
    const { onCreate } = setup({ wallets: [BCA] });
    await user.click(await screen.findByRole('button', { name: 'Simpan tujuan' }));
    expect(
      await screen.findByText('Nama tujuan wajib diisi, paling banyak 60 huruf.'),
    ).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: /Nama tujuan/ }), 'X');
    await user.click(screen.getByRole('button', { name: 'Simpan tujuan' }));
    expect(await screen.findByText('Target harus lebih dari nol dan masuk akal.')).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('tanggal sebelum hari ini ditolak di kolomnya', async () => {
    const user = userEvent.setup();
    const { onCreate } = setup({ wallets: [BCA] });
    await user.type(await screen.findByRole('textbox', { name: /Nama tujuan/ }), 'X');
    await user.type(screen.getByRole('textbox', { name: /Target/ }), '1000');
    // Lewati batas `min` kontrol tanggal dengan mengisi nilainya langsung.
    const date = screen.getByLabelText(/Tanggal target/);
    await user.type(date, '2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Simpan tujuan' }));
    expect(await screen.findByText('Tanggal target tidak boleh sebelum hari ini.')).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('goal_exists dari server: galat di kolom Dompet dengan nama dompet, sheet tetap terbuka', async () => {
    const user = userEvent.setup();
    const { onSaved } = setup({ wallets: [BCA] }, { ok: false, code: 'goal_exists' });
    await user.type(await screen.findByRole('textbox', { name: /Nama tujuan/ }), 'X');
    await user.type(screen.getByRole('textbox', { name: /Target/ }), '1000');
    await user.click(screen.getByRole('button', { name: 'Simpan tujuan' }));
    expect(
      await screen.findByText(
        'Tabungan BCA sudah punya tujuan aktif. Selesaikan atau arsipkan tujuan itu dulu.',
      ),
    ).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('galat jaringan: kotak atas dengan Coba lagi', async () => {
    const user = userEvent.setup();
    setup({ wallets: [BCA] }, { ok: false, code: 'network' });
    await user.type(await screen.findByRole('textbox', { name: /Nama tujuan/ }), 'X');
    await user.type(screen.getByRole('textbox', { name: /Target/ }), '1000');
    await user.click(screen.getByRole('button', { name: 'Simpan tujuan' }));
    expect(await screen.findByText(/Belum berhasil\. Sambungan ke server terputus/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeTruthy();
  });

  it('galat kolom dari server (invalid + field) menempel di kolomnya', async () => {
    const user = userEvent.setup();
    setup({ wallets: [BCA] }, { ok: false, code: 'invalid', field: 'target_amount' });
    await user.type(await screen.findByRole('textbox', { name: /Nama tujuan/ }), 'X');
    await user.type(screen.getByRole('textbox', { name: /Target/ }), '1000');
    await user.click(screen.getByRole('button', { name: 'Simpan tujuan' }));
    expect(await screen.findByText('Target harus lebih dari nol dan masuk akal.')).toBeTruthy();
  });

  it('pemilih kosong: kalimat Semua dompet tabungan sudah punya tujuan, Simpan aria-disabled', async () => {
    const user = userEvent.setup();
    const { onCreate } = setup({ wallets: [] });
    expect(await screen.findByText(/Semua dompet tabungan sudah punya tujuan/)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    const save = screen.getByRole('button', { name: 'Simpan tujuan' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    await user.click(save);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('dompet terkunci (dari Detail dompet): teks Dompet: {nama}, bukan pemilih', async () => {
    setup({ lockedWalletId: 'a2' });
    expect(await screen.findByText('Dompet: Tabungan Jago')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('hitungan sisa huruf mulai 50', async () => {
    const user = userEvent.setup();
    setup({ wallets: [BCA] });
    const name = await screen.findByRole('textbox', { name: /Nama tujuan/ });
    await user.type(name, 'a'.repeat(49));
    expect(screen.queryByText(/^Sisa \d+ huruf\./)).toBeNull();
    await user.type(name, 'aa');
    expect(screen.getByText(/Sisa 9 huruf\./)).toBeTruthy();
  });

  it('tanpa kata Goal di salinan sheet', async () => {
    setup({ wallets: [BCA] });
    await screen.findByRole('dialog');
    expect(document.body.textContent.toLowerCase()).not.toContain('goal');
  });
});

describe('GoalSheet: Ubah (S13-TJ5)', () => {
  it('terisi dari tujuan; dompet terkunci dengan catatan; tanpa pemilih', async () => {
    setup({ goal: goal(), wallets: [] });
    expect(await screen.findByRole('dialog', { name: /^Ubah tujuan\s*Pribadi$/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Nama tujuan/ })).toHaveValue('Dana darurat');
    expect(screen.getByLabelText(/Tanggal target/)).toHaveValue('2027-03-25');
    expect(screen.getByText('Dompet: Tabungan BCA')).toBeTruthy();
    expect(screen.getByText(/Dompet tidak bisa diganti/)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('simpan perubahan: Hapus tanggal = targetOn null; toast pemanggil via onSaved(created false)', async () => {
    const user = userEvent.setup();
    const { onUpdate, onSaved } = setup({ goal: goal(), wallets: [] });
    await user.click(await screen.findByRole('button', { name: 'Hapus tanggal' }));
    await user.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ name: 'Dana darurat', created: false });
    });
    expect(onUpdate.mock.calls[0]?.[0]).toEqual({
      goalId: 'g1',
      name: 'Dana darurat',
      target: 10_000_000,
      targetOn: null,
    });
  });

  it('tanpa perubahan: sheet menutup tanpa memanggil server dan tanpa toast', async () => {
    const user = userEvent.setup();
    const { onUpdate, onSaved, onOpenChange } = setup({ goal: goal(), wallets: [] });
    await user.click(await screen.findByRole('button', { name: 'Simpan perubahan' }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('tanggal lama yang sudah lewat boleh dipertahankan saat nama diganti', async () => {
    const user = userEvent.setup();
    const { onUpdate } = setup({
      goal: goal({ targetOn: '2026-10-01', periodsLeft: null, perPeriod: null }),
      wallets: [],
    });
    const name = await screen.findByRole('textbox', { name: /Nama tujuan/ });
    await user.clear(name);
    await user.type(name, 'Dana baru');
    await user.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });
    expect(onUpdate.mock.calls[0]?.[0].targetOn).toBe('2026-10-01');
  });

  it('goal_not_active: kotak atas dengan salinan, tanpa Coba lagi', async () => {
    const user = userEvent.setup();
    setup({ goal: goal(), wallets: [] }, { ok: false, code: 'goal_not_active' });
    const name = await screen.findByRole('textbox', { name: /Nama tujuan/ });
    await user.type(name, '2');
    await user.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    expect(
      await screen.findByText('Tujuan ini sudah tidak aktif. Muat ulang halaman.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Coba lagi' })).toBeNull();
  });
});
