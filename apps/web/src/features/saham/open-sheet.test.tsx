import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockScope, StockSource } from './context';
import { OpenSheet } from './open-sheet';

afterEach(cleanup);

const open = vi.fn();
const onSaved = vi.fn();
const onOpenChange = vi.fn();
const source = { open } as unknown as StockSource;

const scope: StockScope = {
  ruang: 'pribadi',
  today: '2026-11-16',
  account: { id: 'saham1', name: 'Ajaib', openedOn: '2026-11-12' },
  cash: [],
  holdings: [{ ticker: 'BBCA', shares: 300, close: null, closeOn: null }],
  lastTradeOn: { BBCA: '2026-11-14' },
};

beforeEach(() => {
  vi.clearAllMocks();
  open.mockResolvedValue({ ok: true, value: { amount: 750_000 } });
});

const mount = () =>
  render(
    <OpenSheet open onOpenChange={onOpenChange} scope={scope} source={source} onSaved={onSaved} />,
  );
const field = (name: string | RegExp) => screen.getByRole('textbox', { name });
const save = () => screen.getByRole('button', { name: 'Simpan saham' });

describe('OpenSheet (S14-SH6)', () => {
  it('satuan bawaan Lembar; Sejak bawaan dan paling awal = tanggal dompet saham dibuka; catatan tanpa efek kas', async () => {
    mount();
    await screen.findByRole('dialog', { name: /Saham yang sudah dimiliki/ });
    expect(screen.getByRole('radio', { name: 'Lembar' })).toHaveAttribute('aria-checked', 'true');
    const since = screen.getByLabelText('Sejak');
    expect(since).toHaveValue('2026-11-12');
    expect(since).toHaveAttribute('min', '2026-11-12');
    expect(since).toHaveAttribute('max', '2026-11-16');
    expect(
      screen.getByText(
        'Tidak mengurangi dompet mana pun. Saham ini langsung masuk kekayaan bersih.',
      ),
    ).toBeTruthy();
  });

  it('kode yang sudah dipegang: Menambah ke BBCA yang sudah ada; batas tanggal naik ke transaksi terakhir kode', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.type(field('Kode saham'), 'BBCA');
    expect(screen.getByText('Menambah ke BBCA yang sudah ada.')).toBeTruthy();
    expect(screen.getByLabelText('Sejak')).toHaveAttribute('min', '2026-11-14');
  });

  it('simpan: lembar, harga rata-rata, tanggal; melapor kode dan lembar', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.type(field('Kode saham'), 'tlkm');
    await user.type(field('Jumlah'), '250');
    await user.type(field('Harga rata-rata per lembar'), '3000');
    await user.click(save());
    await waitFor(() => {
      expect(open).toHaveBeenCalledTimes(1);
    });
    expect(open.mock.calls[0]?.[0]).toMatchObject({
      accountId: 'saham1',
      ticker: 'TLKM',
      shares: 250,
      price: 3000,
      on: '2026-11-12',
    });
    expect(onSaved).toHaveBeenCalledWith({ ticker: 'TLKM', shares: 250 });
  });

  it('lot dikali 100; tanggal lebih awal dari dompet ditolak di klien dan di server (before_opening)', async () => {
    const user = userEvent.setup();
    open.mockResolvedValue({ ok: false, error: { code: 'before_opening' } });
    mount();
    await screen.findByRole('dialog');
    await user.type(field('Kode saham'), 'TLKM');
    await user.click(screen.getByRole('radio', { name: 'Lot' }));
    await user.type(field('Jumlah'), '3');
    expect(screen.getByText('= 300 lembar')).toBeTruthy();
    await user.type(field('Harga rata-rata per lembar'), '3000');
    await user.click(save());
    expect(
      await screen.findByText(/Tanggalnya lebih awal dari transaksi atau dompet/),
    ).toBeTruthy();
    expect(open.mock.calls[0]?.[0]).toMatchObject({ shares: 300 });
  });
});
