import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockSource } from './context';
import type { StockTradeVM } from './types';
import { VoidTradeDialog, voidBody } from './void-trade-dialog';

afterEach(cleanup);

const voidTrade = vi.fn();
const onVoided = vi.fn();
const onOpenChange = vi.fn();
const source = { voidTrade } as unknown as StockSource;

const buy: StockTradeVM = {
  id: 't1',
  side: 'buy',
  shares: 200,
  price: 9150,
  occurredOn: '2026-11-14',
  counterName: 'RDN Ajaib',
};

beforeEach(() => {
  vi.clearAllMocks();
  voidTrade.mockResolvedValue({ ok: true, value: { tradeId: 't1' } });
});

const mount = (trade: StockTradeVM = buy) =>
  render(
    <VoidTradeDialog
      open
      onOpenChange={onOpenChange}
      ticker="BBCA"
      trade={trade}
      accountName="Ajaib"
      source={source}
      onVoided={onVoided}
    />,
  );

describe('voidBody (S14-SH7)', () => {
  it('isi per sisi dengan nama dompet dari data yang sudah dimuat', () => {
    expect(voidBody({ ticker: 'BBCA', trade: buy, accountName: 'Ajaib' })).toBe(
      'Beli BBCA 2 lot pada 14 Nov dibatalkan. RDN Ajaib bertambah lagi, lembar dan harga rata-rata kembali seperti sebelumnya. Bisa dipulihkan dari Sampah.',
    );
    expect(
      voidBody({
        ticker: 'BBCA',
        trade: { ...buy, side: 'sell', shares: 100, counterName: 'BCA' },
        accountName: 'Ajaib',
      }),
    ).toBe(
      'Jual BBCA 1 lot pada 14 Nov dibatalkan. BCA berkurang lagi, dan untung atau rugi penjualan itu ikut batal. Bisa dipulihkan dari Sampah.',
    );
    expect(
      voidBody({
        ticker: 'BBCA',
        trade: { ...buy, side: 'opening', shares: 250, counterName: null },
        accountName: 'Ajaib',
      }),
    ).toBe(
      'BBCA 250 lembar yang dimasukkan pada 14 Nov dihapus dari Ajaib. Bisa dipulihkan dari Sampah.',
    );
  });
});

describe('VoidTradeDialog (S14-SH7)', () => {
  it('fokus awal di Kembali; Batalkan transaksi memanggil server dengan trade terakhir', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('alertdialog', { name: 'Batalkan transaksi saham terakhir?' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Kembali' }));
    await user.click(screen.getByRole('button', { name: 'Batalkan transaksi' }));
    await waitFor(() => {
      expect(voidTrade).toHaveBeenCalledTimes(1);
    });
    expect(voidTrade.mock.calls[0]?.[0]).toMatchObject({ tradeId: 't1', allowNegative: false });
    expect(onVoided).toHaveBeenCalledWith(buy);
  });

  it('trade_not_latest: alert dengan kode saham, tombol Batalkan transaksi dimatikan', async () => {
    const user = userEvent.setup();
    voidTrade.mockResolvedValue({ ok: false, error: { code: 'trade_not_latest' } });
    mount();
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Batalkan transaksi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sudah ada transaksi BBCA yang lebih baru. Muat ulang halaman.',
    );
    expect(screen.getByRole('button', { name: 'Batalkan transaksi' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(onVoided).not.toHaveBeenCalled();
  });

  it('saldo_negatif: Tetap batalkan mengirim allowNegative', async () => {
    const user = userEvent.setup();
    voidTrade.mockResolvedValueOnce({ ok: false, error: { code: 'saldo_negatif' } });
    mount({ ...buy, side: 'sell', counterName: 'BCA' });
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Batalkan transaksi' }));
    await user.click(await screen.findByRole('button', { name: 'Tetap batalkan' }));
    await waitFor(() => {
      expect(voidTrade).toHaveBeenCalledTimes(2);
    });
    expect(voidTrade.mock.calls[1]?.[0]).toMatchObject({ allowNegative: true });
  });

  it('not_found: teks Transaksi, bukan Saham (K3); tombol dimatikan', async () => {
    const user = userEvent.setup();
    voidTrade.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    mount();
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Batalkan transaksi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Transaksi ini tidak ditemukan. Muat ulang halaman.',
    );
  });
});
