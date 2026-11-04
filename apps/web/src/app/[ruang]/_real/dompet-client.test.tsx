import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddWalletHost, AddWalletTrigger } from './dompet-client';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  params: { value: '' },
  refresh: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../_actions/dompet', () => ({ createAccountAction: mocks.create }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.params.value),
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock('@/components/ui/toast', () => ({ toast: mocks.toast }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.params.value = '';
});
afterEach(cleanup);

function host() {
  return (
    <AddWalletHost ruang="bersama" existingNames={['Kas Rumah']}>
      <AddWalletTrigger />
    </AddWalletHost>
  );
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  const sheet = await screen.findByRole('dialog', { name: /Tambah dompet/ });
  await user.type(screen.getByRole('textbox', { name: 'Nama' }), '  Tunai  ');
  await user.click(screen.getByRole('radio', { name: 'Operasional' }));
  await user.click(screen.getByRole('radio', { name: 'Tunai' }));
  await user.type(screen.getByRole('textbox', { name: /Saldo hari ini/ }), '75000');
  return sheet;
}

describe('AddWalletHost (Dompet nyata)', () => {
  it('tombol membuka sheet; simpan mengirim createAccountAction dengan ruang dan saldo hari ini', async () => {
    const user = userEvent.setup();
    mocks.create.mockResolvedValue({ ok: true, value: { accountId: 'a-1' } });
    render(host());
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tambah dompet' }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Simpan dompet' }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledTimes(1);
    });
    expect(mocks.create).toHaveBeenCalledWith('bersama', {
      clientId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      name: 'Tunai',
      pocket: 'operasional',
      walletType: 'cash',
      openingBalance: 75_000,
    });
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({ message: 'Dompet Tunai ditambahkan di Bersama' });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('tanpa saldo: openingBalance 0 (tanpa entri Saldo awal)', async () => {
    const user = userEvent.setup();
    mocks.create.mockResolvedValue({ ok: true, value: { accountId: 'a-1' } });
    render(host());
    await user.click(screen.getByRole('button', { name: 'Tambah dompet' }));
    await screen.findByRole('dialog');
    await user.type(screen.getByRole('textbox', { name: 'Nama' }), 'Tabungan');
    await user.click(screen.getByRole('radio', { name: 'Tabungan' }));
    await user.click(screen.getByRole('button', { name: 'Simpan dompet' }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledTimes(1);
    });
    expect(mocks.create.mock.calls[0]?.[1]).toMatchObject({
      pocket: 'tabungan',
      openingBalance: 0,
    });
  });

  it('nama lebih dari 40 karakter ditolak; nama sama dengan dompet yang ada ditolak (tanpa mengirim)', async () => {
    const user = userEvent.setup();
    render(host());
    await user.click(screen.getByRole('button', { name: 'Tambah dompet' }));
    const name = await screen.findByRole('textbox', { name: 'Nama' });
    await user.click(screen.getByRole('radio', { name: 'Operasional' }));
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(name, { target: { value: 'a'.repeat(41) } });
    await user.click(screen.getByRole('button', { name: 'Simpan dompet' }));
    expect(screen.getByText('Nama dompet maksimal 40 karakter.')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'kas rumah' } });
    await user.click(screen.getByRole('button', { name: 'Simpan dompet' }));
    expect(screen.getByText('Dompet bernama Kas Rumah sudah ada di Bersama.')).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('name_taken dari server (S7): galat kolom di bawah Nama, bukan kotak peringatan; fokus ke Nama', async () => {
    const user = userEvent.setup();
    mocks.create.mockResolvedValue({ ok: false, error: { code: 'name_taken' } });
    render(host());
    await user.click(screen.getByRole('button', { name: 'Tambah dompet' }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Simpan dompet' }));
    const name = screen.getByRole('textbox', { name: 'Nama' });
    expect(await screen.findByText('Nama ini sudah dipakai dompet lain di Bersama.')).toBeTruthy();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Coba lagi' })).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(name);
    });
    // Mengganti nama lalu menyimpan lagi mengirim ulang (clientId yang sama aman: simpan pertama ditolak).
    mocks.create.mockResolvedValue({ ok: true, value: { accountId: 'a-1' } });
    await user.clear(name);
    await user.type(name, 'Tunai 2');
    await user.click(screen.getByRole('button', { name: 'Simpan dompet' }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledTimes(2);
    });
  });

  it('galat jaringan: peringatan + Coba lagi memakai clientId yang sama (tidak membuat dua dompet)', async () => {
    const user = userEvent.setup();
    mocks.create
      .mockRejectedValueOnce(new Error('putus'))
      .mockResolvedValue({ ok: true, value: { accountId: 'a-1' } });
    render(host());
    await user.click(screen.getByRole('button', { name: 'Tambah dompet' }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Simpan dompet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Koneksi terputus saat mengirim');
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledTimes(2);
    });
    const [first, second] = mocks.create.mock.calls as [
      [string, { clientId: string }],
      [string, { clientId: string }],
    ];
    expect(second[1].clientId).toBe(first[1].clientId);
  });

  it('koneksi putus sesudah server menyimpan: mengubah saldo lalu simpan tetap memakai clientId yang sama', async () => {
    const user = userEvent.setup();
    mocks.create
      .mockRejectedValueOnce(new Error('putus'))
      .mockResolvedValue({ ok: true, value: { accountId: 'a-1' } });
    render(host());
    await user.click(screen.getByRole('button', { name: 'Tambah dompet' }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Simpan dompet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Koneksi terputus saat mengirim');
    const amount = screen.getByRole('textbox', { name: /Saldo hari ini/ });
    await user.clear(amount);
    await user.type(amount, '90000');
    await user.click(screen.getByRole('radio', { name: 'Bank' }));
    await user.click(screen.getByRole('button', { name: 'Simpan dompet' }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledTimes(2);
    });
    const [first, second] = mocks.create.mock.calls as [
      [string, { clientId: string; openingBalance: number }],
      [string, { clientId: string; openingBalance: number }],
    ];
    expect(second[1].openingBalance).toBe(90_000);
    expect(second[1].clientId).toBe(first[1].clientId);
  });

  it('idem_mismatch (kunci sama, isi beda): pesan "mungkin sudah tersimpan", tanpa Coba lagi, daftar dimuat ulang', async () => {
    const user = userEvent.setup();
    mocks.create.mockResolvedValue({ ok: false, error: { code: 'idem_mismatch' } });
    render(host());
    await user.click(screen.getByRole('button', { name: 'Tambah dompet' }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Simpan dompet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Dompet ini mungkin sudah tersimpan. Tutup lalu periksa daftar dompet.',
    );
    expect(screen.queryByRole('button', { name: 'Coba lagi' })).toBeNull();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('?tambah=1 membuka sheet sejak awal; menutup membuang parameter dari alamat', async () => {
    const user = userEvent.setup();
    mocks.params.value = 'tambah=1';
    const replace = vi.spyOn(window.history, 'replaceState');
    window.history.pushState(null, '', '/bersama/dompet?theme=light&tambah=1');
    render(host());
    expect(await screen.findByRole('dialog', { name: /Tambah dompet/ })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(replace).toHaveBeenLastCalledWith(null, '', '/bersama/dompet?theme=light');
  });

  it('alamat berganti ke ?tambah=1 selagi halaman terbuka: sheet terbuka', async () => {
    mocks.params.value = '';
    const { rerender } = render(host());
    expect(screen.queryByRole('dialog')).toBeNull();
    mocks.params.value = 'tambah=1';
    rerender(host());
    expect(await screen.findByRole('dialog', { name: /Tambah dompet/ })).toBeTruthy();
  });
});
