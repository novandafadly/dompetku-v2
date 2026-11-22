import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ruang } from '@/features/ledger/types';
import { AddAssetSheet, type AddAssetResult } from './add-asset-sheet';

afterEach(cleanup);

const onSubmit = vi.fn<(i: unknown) => Promise<AddAssetResult>>();
const onSaved = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  onSubmit.mockResolvedValue({ ok: true, accountId: 'new-1' });
});

const mount = (ruang: Ruang = 'pribadi', existing: string[] = ['BCA']) =>
  render(
    <AddAssetSheet
      open
      onOpenChange={vi.fn()}
      ruang={ruang}
      today="2026-11-16"
      existingNames={existing}
      onSubmit={onSubmit}
      onSaved={onSaved}
    />,
  );

const kind = () => screen.getByLabelText('Jenis aset');
const name = () => screen.getByRole('textbox', { name: 'Nama' });
const save = () => screen.getByRole('button', { name: 'Simpan aset' });

describe('AddAssetSheet (S14-AS2)', () => {
  it('judul dengan ruang; jenis, nama, nilai sekarang (opsional); petunjuk jenis tetap', async () => {
    mount();
    expect(await screen.findByRole('dialog', { name: /Tambah aset/ })).toBeTruthy();
    expect(screen.getByText('Jenis tidak bisa diganti sesudah disimpan.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Nilai sekarang/ })).toBeTruthy();
    expect(document.activeElement).toBe(kind());
  });

  it('Saham hanya di Pribadi: Bersama tidak menawarkannya (dan tanpa kata saham)', async () => {
    const { unmount } = mount('pribadi');
    await screen.findByRole('dialog');
    expect(screen.getByRole('option', { name: 'Saham' })).toBeTruthy();
    unmount();
    mount('bersama');
    await screen.findByRole('dialog');
    expect(screen.queryByRole('option', { name: 'Saham' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Emas' })).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).not.toMatch(/saham/i);
  });

  it('jenis Saham: tanpa Nilai sekarang, petunjuk pengganti, nilai awal 0 dikirim', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.selectOptions(kind(), 'saham');
    expect(screen.queryByRole('textbox', { name: /Nilai sekarang/ })).toBeNull();
    expect(
      screen.getByText('Saham diisi sesudah ini lewat Beli saham atau Saham yang sudah dimiliki.'),
    ).toBeTruthy();
    await user.type(name(), 'Ajaib');
    await user.click(save());
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Ajaib', assetKind: 'saham', openingBalance: 0 }),
      );
    });
    expect(onSaved).toHaveBeenCalledWith({ accountId: 'new-1', name: 'Ajaib', assetKind: 'saham' });
  });

  it('petunjuk nama mengikuti jenis; nilai awal diisi memunculkan Sejak dan terkirim bersama tanggal', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.selectOptions(kind(), 'properti');
    expect(screen.getByText('Misalnya Rumah Bekasi.')).toBeTruthy();
    expect(screen.queryByLabelText('Sejak')).toBeNull();
    await user.type(name(), 'Rumah Bekasi');
    await user.type(screen.getByRole('textbox', { name: /Nilai sekarang/ }), '500000000');
    expect(screen.getByLabelText('Sejak')).toBeTruthy();
    await user.click(save());
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          assetKind: 'properti',
          openingBalance: 500_000_000,
          openedOn: '2026-11-16',
        }),
      );
    });
  });

  it('validasi: jenis kosong, nama kosong, nama bentrok dengan dompet; server tidak dipanggil', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.click(save());
    expect(screen.getByText('Pilih jenis aset.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.selectOptions(kind(), 'emas');
    await user.click(save());
    expect(screen.getByText(/Nama aset wajib diisi/)).toBeTruthy();
    await user.type(name(), 'bca');
    await user.click(save());
    expect(screen.getByText('Dompet atau aset bernama bca sudah ada di Pribadi.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('galat server: name_taken di kolom nama; jaringan = Coba lagi dengan clientId sama', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.selectOptions(kind(), 'emas');
    await user.type(name(), 'Emas Antam');
    onSubmit.mockResolvedValueOnce({ ok: false, code: 'network' });
    await user.click(save());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sambungan ke server terputus');
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });
    const first = onSubmit.mock.calls[0]?.[0] as { clientId: string };
    const second = onSubmit.mock.calls[1]?.[0] as { clientId: string };
    expect(second.clientId).toBe(first.clientId);
  });

  it('name_taken dari server: galat di kolom Nama tanpa nominal', async () => {
    const user = userEvent.setup();
    onSubmit.mockResolvedValue({ ok: false, code: 'name_taken' });
    mount();
    await screen.findByRole('dialog');
    await user.selectOptions(kind(), 'emas');
    await user.type(name(), 'Emas Antam');
    await user.click(save());
    expect(
      await screen.findByText('Dompet atau aset bernama Emas Antam sudah ada di Pribadi.'),
    ).toBeTruthy();
  });

  it('nilai di atas 10^13: teks terlalu besar (bukan minus), fokus ke kolom, server tidak dipanggil', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.selectOptions(kind(), 'emas');
    await user.type(name(), 'Emas Antam');
    const value = screen.getByRole('textbox', { name: /Nilai sekarang/ });
    await user.type(value, '99999999999999');
    await user.click(save());
    expect(
      await screen.findByText('Nilai terlalu besar. Maksimal Rp 10.000.000.000.000.'),
    ).toBeTruthy();
    expect(screen.queryByText('Nilai tidak boleh minus.')).toBeNull();
    expect(document.activeElement).toBe(value);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Sejak boleh sampai 2000 (min kolom); occurred_on dari server = galat kolom tanggal', async () => {
    const user = userEvent.setup();
    onSubmit.mockResolvedValue({ ok: false, code: 'invalid', field: 'occurred_on' });
    mount();
    await screen.findByRole('dialog');
    await user.selectOptions(kind(), 'emas');
    await user.type(name(), 'Emas Antam');
    await user.type(screen.getByRole('textbox', { name: /Nilai sekarang/ }), '1000000');
    const since = screen.getByLabelText('Sejak');
    expect(since.getAttribute('min')).toBe('2000-01-01');
    await user.click(save());
    expect(
      await screen.findByText('Tanggal harus antara 1 Januari 2000 dan hari ini.'),
    ).toBeTruthy();
    expect(document.activeElement).toBe(since);
  });
});
