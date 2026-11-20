import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StockScope, StockSource } from './context';
import { TradeSheet, type TradeMode } from './trade-sheet';

afterEach(cleanup);

const buy = vi.fn();
const sell = vi.fn();
const preview = vi.fn();
const onSaved = vi.fn();
const onOpenChange = vi.fn();
const onStale = vi.fn();
const source = { buy, sell, preview } as unknown as StockSource;

const scope: StockScope = {
  ruang: 'pribadi',
  today: '2026-11-16',
  account: { id: 'saham1', name: 'Ajaib', openedOn: '2026-11-01' },
  cash: [
    { id: 'rdn', name: 'RDN Ajaib', pocket: 'trading', balance: 5_000_000, openedOn: '2026-11-01' },
    { id: 'bca', name: 'BCA', pocket: 'operasional', balance: 2_000_000, openedOn: '2026-10-01' },
  ],
  holdings: [
    { ticker: 'BBCA', shares: 300, close: 9_800, closeOn: '2026-11-14' },
    { ticker: 'TLKM', shares: 250, close: null, closeOn: null },
  ],
  lastTradeOn: { BBCA: '2026-11-10' },
};

beforeEach(() => {
  vi.clearAllMocks();
  buy.mockResolvedValue({ ok: true, value: { amount: 1_831_000 } });
  sell.mockResolvedValue({ ok: true, value: { proceeds: 977_000, realized: 56_667 } });
  preview.mockResolvedValue({
    ok: true,
    value: { costRemoved: 920_333, proceeds: 977_000, realized: 56_667 },
  });
});

const mount = (mode: TradeMode, extra: { lockedTicker?: string; scope?: StockScope } = {}) =>
  render(
    <TradeSheet
      open
      onOpenChange={onOpenChange}
      mode={mode}
      scope={extra.scope ?? scope}
      source={source}
      lockedTicker={extra.lockedTicker}
      onSaved={onSaved}
      onStale={onStale}
    />,
  );

const field = (name: string | RegExp) => screen.getByRole('textbox', { name });
const saveBuy = () =>
  screen.getByRole('button', { name: /Simpan pembelian|Tetap simpan pembelian/ });
const saveSell = () => screen.getByRole('button', { name: 'Simpan penjualan' });

describe('TradeSheet Beli (S14-SH3)', () => {
  it('judul dengan ruang; kode awal fokus, kapital otomatis, petunjuk 4 huruf; dompet trading lebih dulu', async () => {
    const user = userEvent.setup();
    mount('buy');
    const dialog = await screen.findByRole('dialog', { name: /Beli saham/ });
    expect(dialog).toHaveTextContent('Pribadi');
    expect(document.activeElement).toBe(field('Kode saham'));
    await user.type(field('Kode saham'), 'bbca1');
    expect(field('Kode saham')).toHaveValue('BBCA');
    expect(screen.getByText('4 huruf, misalnya BBCA.')).toBeTruthy();
    const options = within(screen.getByRole('combobox', { name: 'Dari dompet' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['RDN Ajaib', 'BCA']);
  });

  it('lot dikali 100 saat dikirim; teks pasti = 200 lembar; perkiraan Total keluar berlabel Perkiraan', async () => {
    const user = userEvent.setup();
    mount('buy');
    await screen.findByRole('dialog');
    await user.type(field('Kode saham'), 'BBCA');
    await user.type(field('Jumlah'), '2');
    expect(screen.getByText('= 200 lembar')).toBeTruthy();
    await user.type(field('Harga per lembar'), '9150');
    await user.type(field(/Biaya broker/), '1000');
    const status = screen.getAllByRole('status').find((s) => s.textContent.includes('Total keluar'));
    expect(status).toHaveTextContent(/Total keluar\s+Rp\s*1\.831\.000/);
    expect(status).toHaveTextContent('Perkiraan. Angka pasti muncul sesudah disimpan.');
    await user.click(saveBuy());
    await waitFor(() => {
      expect(buy).toHaveBeenCalledTimes(1);
    });
    const req = buy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(req).toMatchObject({
      accountId: 'saham1',
      ticker: 'BBCA',
      shares: 200,
      price: 9150,
      fee: 1000,
      fromAccountId: 'rdn',
      allowNegative: false,
    });
    expect(req).not.toHaveProperty('on');
    // Toast memakai nominal server, dilaporkan lewat onSaved.
    expect(onSaved).toHaveBeenCalledWith({
      mode: 'buy',
      ticker: 'BBCA',
      shares: 200,
      amount: 1_831_000,
      realized: null,
      cashName: 'RDN Ajaib',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('satuan Lembar: teks pasti = 2 lot bila habis dibagi 100, tanpa pecahan lot untuk odd lot', async () => {
    const user = userEvent.setup();
    mount('buy');
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('radio', { name: 'Lembar' }));
    await user.type(field('Jumlah'), '200');
    expect(screen.getByText('= 2 lot')).toBeTruthy();
    await user.clear(field('Jumlah'));
    await user.type(field('Jumlah'), '250');
    expect(screen.queryByText(/= .* lot/)).toBeNull();
  });

  it('dari dompet trading: catatan modal tidak berubah; dari dompet biasa: tidak ada catatan', async () => {
    const user = userEvent.setup();
    mount('buy');
    await screen.findByRole('dialog');
    await user.type(field('Kode saham'), 'BBCA');
    await user.type(field('Jumlah'), '1');
    await user.type(field('Harga per lembar'), '9000');
    expect(
      screen.getByText('Pindah dari RDN Ajaib ke saham tidak mengubah modal trading.'),
    ).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dari dompet' }), 'bca');
    expect(screen.queryByText(/tidak mengubah modal trading/)).toBeNull();
  });

  it('saldo dompet sumber kurang: peringatan, tombol Tetap simpan pembelian, mengirim allowNegative', async () => {
    const user = userEvent.setup();
    mount('buy');
    await screen.findByRole('dialog');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dari dompet' }), 'bca');
    await user.type(field('Kode saham'), 'BBCA');
    await user.type(field('Jumlah'), '5');
    await user.type(field('Harga per lembar'), '9000'); // 4.500.000 > 2.000.000
    expect(
      screen.getByText(/Saldo BCA tidak cukup. Kalau dibeli, saldonya jadi minus./),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Tetap simpan pembelian' }));
    await waitFor(() => {
      expect(buy).toHaveBeenCalledTimes(1);
    });
    expect(buy.mock.calls[0]?.[0]).toMatchObject({ allowNegative: true });
  });

  it('server menolak saldo_negatif sekali: peringatan muncul, simpan berikutnya allowNegative', async () => {
    const user = userEvent.setup();
    buy.mockResolvedValueOnce({ ok: false, error: { code: 'saldo_negatif' } });
    mount('buy');
    await screen.findByRole('dialog');
    await user.type(field('Kode saham'), 'BBCA');
    await user.type(field('Jumlah'), '1');
    await user.type(field('Harga per lembar'), '9000');
    await user.click(saveBuy());
    await screen.findByText(/Kalau dibeli, saldonya jadi minus/);
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Tetap simpan pembelian' }));
    await waitFor(() => {
      expect(buy).toHaveBeenCalledTimes(2);
    });
    expect(buy.mock.calls[1]?.[0]).toMatchObject({ allowNegative: true });
  });

  it('validasi di klien: kode salah, jumlah kosong, harga kosong tidak memanggil server', async () => {
    const user = userEvent.setup();
    mount('buy');
    await screen.findByRole('dialog');
    await user.type(field('Kode saham'), 'BB');
    await user.click(saveBuy());
    expect(await screen.findByText('Kode saham terdiri dari 4 huruf, misalnya BBCA.')).toBeTruthy();
    await user.type(field('Kode saham'), 'CA');
    await user.click(saveBuy());
    expect(await screen.findByText('Isi jumlah bulat, paling sedikit 1.')).toBeTruthy();
    await user.type(field('Jumlah'), '1');
    await user.click(saveBuy());
    expect(
      await screen.findByText('Harga harus angka bulat lebih dari nol dan masuk akal.'),
    ).toBeTruthy();
    expect(buy).not.toHaveBeenCalled();
  });

  it('tanggal paling awal = terbesar dari dompet saham, dompet sumber, dan transaksi terakhir kode', async () => {
    const user = userEvent.setup();
    mount('buy');
    await screen.findByRole('dialog');
    await user.type(field('Kode saham'), 'BBCA');
    const date = screen.getByLabelText('Tanggal');
    expect(date).toHaveAttribute('min', '2026-11-10');
    expect(date).toHaveAttribute('max', '2026-11-16');
    await user.clear(field('Kode saham'));
    await user.type(field('Kode saham'), 'ASII');
    expect(date).toHaveAttribute('min', '2026-11-01');
  });

  it('before_latest_entry dari server: galat di kolom Tanggal; kode galat jaringan: Coba lagi memakai clientId sama', async () => {
    const user = userEvent.setup();
    buy.mockResolvedValueOnce({ ok: false, error: { code: 'before_latest_entry' } });
    mount('buy');
    await screen.findByRole('dialog');
    await user.type(field('Kode saham'), 'BBCA');
    await user.type(field('Jumlah'), '1');
    await user.type(field('Harga per lembar'), '9000');
    await user.click(saveBuy());
    expect(
      await screen.findByText(/Tanggalnya lebih awal dari transaksi atau dompet/),
    ).toBeTruthy();
    buy.mockResolvedValueOnce({ ok: false, error: { code: 'network' } });
    await user.click(saveBuy());
    await user.click(await screen.findByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => {
      expect(buy).toHaveBeenCalledTimes(3);
    });
    const ids = buy.mock.calls.map((c) => (c[0] as { clientId: string }).clientId);
    expect(new Set(ids).size).toBe(1);
  });

  it('kode terkunci (Beli lagi): bukan isian; idem_mismatch memicu muat ulang', async () => {
    const user = userEvent.setup();
    buy.mockResolvedValue({ ok: false, error: { code: 'idem_mismatch' } });
    mount('buy', { lockedTicker: 'BBCA' });
    await screen.findByRole('dialog');
    expect(field('Kode saham')).toHaveAttribute('readonly');
    expect(field('Kode saham')).toHaveValue('BBCA');
    await user.type(field('Jumlah'), '1');
    await user.type(field('Harga per lembar'), '9000');
    await user.click(saveBuy());
    expect(await screen.findByRole('alert')).toHaveTextContent('bentrok');
    expect(onStale).toHaveBeenCalled();
  });

  it('tanpa dompet kas: ajakan menambah dompet, tanpa tombol simpan', async () => {
    mount('buy', { scope: { ...scope, cash: [] } });
    await screen.findByRole('dialog');
    expect(screen.getByText(/Belum ada dompet untuk pembelian/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Simpan pembelian/ })).toBeNull();
  });
});

describe('TradeSheet Jual (S14-SH4)', () => {
  it('kode = pilihan dari yang dipegang dengan teks Dimiliki; Jual semua mengisi lembar penuh', async () => {
    const user = userEvent.setup();
    mount('sell');
    await screen.findByRole('dialog', { name: /Jual saham/ });
    const kode = screen.getByRole('combobox', { name: 'Kode saham' });
    expect(
      within(kode)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['BBCA', 'TLKM']);
    expect(screen.getByText('Dimiliki 300 lembar · 3 lot')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Jual semua' }));
    expect(field('Jumlah')).toHaveValue('300');
    await user.selectOptions(kode, 'TLKM');
    expect(screen.getByText('Dimiliki 250 lembar')).toBeTruthy();
  });

  it('pratinjau dari server sesudah jeda: hasil bersih, biaya beli keluar, untung dengan kata (netral)', async () => {
    const user = userEvent.setup();
    mount('sell');
    await screen.findByRole('dialog');
    await user.type(field('Jumlah'), '1');
    await user.type(field('Harga per lembar'), '9800');
    await user.type(field(/Biaya broker/), '2000');
    await user.type(field(/Pajak jual/), '1000');
    expect(preview).not.toHaveBeenCalled(); // masih menunggu jeda ketikan
    const box = await waitFor(
      () => {
        const el = screen.getAllByRole('status').find((s) => s.textContent.includes('Hasil bersih'));
        if (!el) throw new Error('pratinjau belum ada');
        return el;
      },
      { timeout: 3000 },
    );
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0]?.[0]).toEqual({
      accountId: 'saham1',
      ticker: 'BBCA',
      shares: 100,
      price: 9800,
      fee: 2000,
      tax: 1000,
    });
    expect(box).toHaveTextContent(/Hasil bersih\s*Rp\s*977\.000/);
    expect(box).toHaveTextContent(/Biaya beli yang keluar\s*Rp\s*920\.333/);
    expect(box).toHaveTextContent(/\+Rp\s*56\.667 untung/);
    expect(box.innerHTML).not.toMatch(/text-income|text-danger/);
  });

  it('pratinjau rugi dan impas memakai kata; gagal: kalimat pratinjau, simpan tetap boleh', async () => {
    const user = userEvent.setup();
    preview.mockResolvedValueOnce({
      ok: true,
      value: { costRemoved: 1_000_000, proceeds: 880_000, realized: -120_000 },
    });
    mount('sell');
    await screen.findByRole('dialog');
    await user.type(field('Jumlah'), '1');
    await user.type(field('Harga per lembar'), '8800');
    expect(
      await screen.findByText(/−Rp\s*120\.000 rugi/, undefined, { timeout: 3000 }),
    ).toBeTruthy();
    preview.mockResolvedValueOnce({ ok: false, error: { code: 'network' } });
    await user.type(field('Harga per lembar'), '1');
    expect(
      await screen.findByText(
        'Pratinjau belum bisa dihitung. Angka pasti muncul sesudah disimpan.',
        undefined,
        { timeout: 3000 },
      ),
    ).toBeTruthy();
    await user.click(saveSell());
    await waitFor(() => {
      expect(sell).toHaveBeenCalledTimes(1);
    });
  });

  it('jumlah melebihi yang dimiliki: galat kolom, pratinjau tidak dipanggil, simpan ditolak di klien', async () => {
    const user = userEvent.setup();
    mount('sell');
    await screen.findByRole('dialog');
    await user.type(field('Jumlah'), '4'); // 4 lot = 400 > 300
    await user.type(field('Harga per lembar'), '9800');
    await user.click(saveSell());
    expect(await screen.findByText('Jumlahnya melebihi saham yang dimiliki.')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 600));
    expect(preview).not.toHaveBeenCalled();
    expect(sell).not.toHaveBeenCalled();
  });

  it('simpan: mengirim pajak dan dompet tujuan; toast membawa hasil dan untung dari server', async () => {
    const user = userEvent.setup();
    mount('sell');
    await screen.findByRole('dialog');
    await user.type(field('Jumlah'), '1');
    await user.type(field('Harga per lembar'), '9800');
    await user.type(field(/Pajak jual/), '1000');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Ke dompet' }), 'bca');
    await user.click(saveSell());
    await waitFor(() => {
      expect(sell).toHaveBeenCalledTimes(1);
    });
    expect(sell.mock.calls[0]?.[0]).toMatchObject({
      ticker: 'BBCA',
      shares: 100,
      price: 9800,
      fee: 0,
      tax: 1000,
      toAccountId: 'bca',
    });
    expect(onSaved).toHaveBeenCalledWith({
      mode: 'sell',
      ticker: 'BBCA',
      shares: 100,
      amount: 977_000,
      realized: 56_667,
      cashName: 'BCA',
    });
  });

  it('insufficient_shares dari server dipetakan ke kolom Jumlah', async () => {
    const user = userEvent.setup();
    sell.mockResolvedValue({ ok: false, error: { code: 'insufficient_shares' } });
    mount('sell');
    await screen.findByRole('dialog');
    await user.type(field('Jumlah'), '1');
    await user.type(field('Harga per lembar'), '9800');
    await user.click(saveSell());
    expect(await screen.findByText('Jumlahnya melebihi saham yang dimiliki.')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
