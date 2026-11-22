import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RevalueSheet, type RevalueSource } from './revalue-sheet';

afterEach(cleanup);

const revalue = vi.fn();
const onSaved = vi.fn();
const onOpenChange = vi.fn();
const onStale = vi.fn();
const source: RevalueSource = { revalue };

beforeEach(() => {
  vi.clearAllMocks();
  revalue.mockResolvedValue({ ok: true, value: { entryId: 'e1', delta: 300_000 } });
});

const mount = (lastOn: string | null = '2026-11-10') =>
  render(
    <RevalueSheet
      open
      onOpenChange={onOpenChange}
      ruang="pribadi"
      today="2026-11-16"
      asset={{ id: 'as1', name: 'Emas Antam', balance: 5_000_000, lastOn }}
      source={source}
      onSaved={onSaved}
      onStale={onStale}
    />,
  );

const input = () => screen.getByRole('textbox', { name: 'Nilai sekarang' });
const save = () => screen.getByRole('button', { name: 'Simpan nilai' });

describe('RevalueSheet (S14-AS4)', () => {
  it('judul dengan nama dan ruang; nilai tercatat + tanggal; fokus awal di nilai sekarang', async () => {
    mount();
    expect(await screen.findByRole('dialog', { name: /Perbarui nilai Emas Antam/ })).toBeTruthy();
    expect(screen.getByText(/Tercatat\s+Rp\s*5\.000\.000 per 10 Nov\./)).toBeTruthy();
    expect(document.activeElement).toBe(input());
    expect(screen.getByText(/Perubahan nilai tidak masuk Laporan dan anggaran/)).toBeTruthy();
  });

  it('tanpa tanggal valuasi: Tercatat tanpa "per"', async () => {
    mount(null);
    await screen.findByRole('dialog');
    expect(screen.getByText(/Tercatat\s+Rp\s*5\.000\.000\./)).toBeTruthy();
  });

  it('pratinjau: Naik / Turun / Nilainya sama (kata + ikon, netral)', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.type(input(), '5300000');
    expect(screen.getByRole('status')).toHaveTextContent(/Naik\s+Rp\s*300\.000/);
    await user.clear(input());
    await user.type(input(), '4800000');
    expect(screen.getByRole('status')).toHaveTextContent(/Turun\s+Rp\s*200\.000/);
    await user.clear(input());
    await user.type(input(), '5000000');
    expect(screen.getByRole('status')).toHaveTextContent('Nilainya sama, tidak ada yang dicatat.');
    expect(screen.getByRole('status').innerHTML).not.toMatch(/text-income|text-danger/);
  });

  it('nilai sama: menutup tanpa memanggil server dan tanpa toast (onSaved)', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.type(input(), '5000000');
    await user.click(save());
    expect(revalue).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('simpan: mengirim nilai (tanggal hari ini tidak dikirim), menutup, melapor hasil server', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.type(input(), '5300000');
    await user.click(save());
    await waitFor(() => {
      expect(revalue).toHaveBeenCalledTimes(1);
    });
    const req = revalue.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(req).toMatchObject({ accountId: 'as1', value: 5_300_000 });
    expect(req).not.toHaveProperty('on');
    expect(onSaved).toHaveBeenCalledWith({ entryId: 'e1', delta: 300_000 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('tanggal sebelum transaksi terakhir (before_latest_entry): galat di kolom Tanggal, tanpa nominal', async () => {
    const user = userEvent.setup();
    revalue.mockResolvedValue({ ok: false, error: { code: 'before_latest_entry' } });
    mount();
    await screen.findByRole('dialog');
    await user.type(input(), '5300000');
    await user.click(save());
    expect(
      await screen.findByText(/Tanggalnya lebih awal dari transaksi terakhir Emas Antam/),
    ).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('jaringan: Coba lagi memakai clientId sama', async () => {
    const user = userEvent.setup();
    revalue.mockResolvedValueOnce({ ok: false, error: { code: 'network' } });
    mount();
    await screen.findByRole('dialog');
    await user.type(input(), '5300000');
    await user.click(save());
    await user.click(await screen.findByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => {
      expect(revalue).toHaveBeenCalledTimes(2);
    });
    const [a, b] = revalue.mock.calls.map((c) => (c[0] as { clientId: string }).clientId);
    expect(a).toBe(b);
  });
});

describe('RevalueSheet: idem_mismatch', () => {
  it('memicu muat ulang (onStale) dan menampilkan galat bentrok', async () => {
    const user = userEvent.setup();
    revalue.mockResolvedValue({ ok: false, error: { code: 'idem_mismatch' } });
    mount();
    await screen.findByRole('dialog');
    await user.type(input(), '5300000');
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('bentrok');
    expect(onStale).toHaveBeenCalled();
  });

  it('nilai di atas 10^13: galat di kolom (terlalu besar), fokus ke kolom, server tidak dipanggil', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.type(input(), '99999999999999');
    await user.click(save());
    expect(
      await screen.findByText('Nilai terlalu besar. Maksimal Rp 10.000.000.000.000.'),
    ).toBeTruthy();
    expect(document.activeElement).toBe(input());
    expect(revalue).not.toHaveBeenCalled();
  });

  it('invalid dari server: occurred_on = galat Tanggal (bukan teks minus); value = galat kolom nilai', async () => {
    const user = userEvent.setup();
    revalue.mockResolvedValueOnce({ ok: false, error: { code: 'invalid', field: 'occurred_on' } });
    mount();
    await screen.findByRole('dialog');
    await user.type(input(), '5300000');
    await user.click(save());
    expect(
      await screen.findByText('Tanggal harus antara 1 Januari 2000 dan hari ini.'),
    ).toBeTruthy();
    expect(screen.queryByText('Nilai tidak boleh minus.')).toBeNull();
    expect(screen.getByLabelText('Tanggal').getAttribute('min')).toBe('2000-01-01');
    revalue.mockResolvedValueOnce({ ok: false, error: { code: 'invalid', field: 'value' } });
    await user.click(save());
    expect(await screen.findByText('Nilai tidak boleh minus.')).toBeTruthy();
    expect(document.activeElement).toBe(input());
  });
});
