import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockScope, StockSource } from './context';
import { PriceSheet } from './price-sheet';

afterEach(cleanup);

const setPrice = vi.fn();
const onSaved = vi.fn();
const onOpenChange = vi.fn();
const source = { setPrice } as unknown as StockSource;

const scope: StockScope = {
  ruang: 'pribadi',
  today: '2026-11-16',
  account: { id: 'saham1', name: 'Ajaib', openedOn: '2026-11-01' },
  cash: [],
  holdings: [
    { ticker: 'BBCA', shares: 300, close: 9_800, closeOn: '2026-11-14' },
    { ticker: 'TLKM', shares: 250, close: null, closeOn: null },
  ],
  lastTradeOn: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  setPrice.mockResolvedValue({ ok: true, value: { onDate: '2026-11-16' } });
});

const mount = (lockedTicker?: string) =>
  render(
    <PriceSheet
      open
      onOpenChange={onOpenChange}
      scope={scope}
      source={source}
      lockedTicker={lockedTicker}
      onSaved={onSaved}
    />,
  );
const price = () => screen.getByRole('textbox', { name: 'Harga penutupan per lembar' });
const save = () => screen.getByRole('button', { name: 'Simpan harga' });

describe('PriceSheet (S14-SH5)', () => {
  it('harga terakhir + tanggal untuk kode terpilih, Belum ada harga untuk kode tanpa harga; cakupan semua dompet saham', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog', { name: /Isi harga/ });
    expect(document.activeElement).toBe(price());
    expect(screen.getByText(/Harga terakhir\s+Rp\s*9\.800 · 14 Nov/)).toBeTruthy();
    expect(
      screen.getByText('Harga berlaku untuk BBCA di semua dompet saham Pribadi.'),
    ).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kode saham' }), 'TLKM');
    expect(screen.getByText('Belum ada harga.')).toBeTruthy();
  });

  it('simpan: kode, harga, tanggal hari ini tidak dikirim, tanpa konfirmasi lonjakan; melapor tanggal dari server', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.type(price(), '9900');
    await user.click(save());
    await waitFor(() => {
      expect(setPrice).toHaveBeenCalledTimes(1);
    });
    const req = setPrice.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(req).toMatchObject({ ticker: 'BBCA', close: 9900, confirmSpike: false });
    expect(req).not.toHaveProperty('on');
    expect(onSaved).toHaveBeenCalledWith({ ticker: 'BBCA', on: '2026-11-16' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('lonjakan: kotak peringatan role=alert dengan tanggal pembanding (tanpa nominal), sakelar Ya, harga ini benar mengirim konfirmasi', async () => {
    const user = userEvent.setup();
    setPrice.mockResolvedValueOnce({ ok: false, error: { code: 'price_spike_unconfirmed' } });
    mount();
    await screen.findByRole('dialog');
    await user.type(price(), '15000');
    await user.click(save());
    const box = await screen.findByRole('alert');
    expect(box).toHaveTextContent(
      'Harga ini berubah lebih dari 35% dari harga 14 Nov. Periksa lagi angkanya, misalnya bila ada pemecahan saham.',
    );
    expect(box.textContent).not.toMatch(/\d{1,3}\.\d{3}/);
    expect(onSaved).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: 'Ya, harga ini benar' }));
    await user.click(save());
    await waitFor(() => {
      expect(setPrice).toHaveBeenCalledTimes(2);
    });
    expect(setPrice.mock.calls[1]?.[0]).toMatchObject({ confirmSpike: true, close: 15000 });
    expect(onSaved).toHaveBeenCalled();
  });

  it('mengubah harga sesudah lonjakan menghapus konfirmasi; harga tidak sah ditolak di klien', async () => {
    const user = userEvent.setup();
    setPrice.mockResolvedValueOnce({ ok: false, error: { code: 'price_spike_unconfirmed' } });
    mount();
    await screen.findByRole('dialog');
    await user.click(save());
    expect(
      await screen.findByText('Harga harus angka bulat lebih dari nol dan masuk akal.'),
    ).toBeTruthy();
    expect(setPrice).not.toHaveBeenCalled();
    await user.type(price(), '15000');
    await user.click(save());
    await screen.findByRole('checkbox', { name: 'Ya, harga ini benar' });
    await user.type(price(), '1');
    expect(screen.queryByRole('checkbox', { name: 'Ya, harga ini benar' })).toBeNull();
  });

  it('kode terkunci dari baris; galat server DK400 price_invalid = galat kolom harga', async () => {
    const user = userEvent.setup();
    setPrice.mockResolvedValue({ ok: false, error: { code: 'invalid', field: 'close' } });
    mount('TLKM');
    await screen.findByRole('dialog');
    expect(screen.queryByRole('combobox', { name: 'Kode saham' })).toBeNull();
    await user.type(price(), '3000');
    await user.click(save());
    expect(
      await screen.findByText('Harga harus angka bulat lebih dari nol dan masuk akal.'),
    ).toBeTruthy();
    expect(setPrice.mock.calls[0]?.[0]).toMatchObject({ ticker: 'TLKM' });
  });
});
