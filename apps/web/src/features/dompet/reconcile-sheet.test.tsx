import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconcileSheet, type ReconcileSource } from './reconcile-sheet';

afterEach(cleanup);

const reconcile = vi.fn();
const onSaved = vi.fn();
const onStale = vi.fn();
const source: ReconcileSource = { reconcile };

beforeEach(() => {
  vi.clearAllMocks();
});

function Harness({ balance = 1_250_000 }: { balance?: number }) {
  const [open, setOpen] = useState(true);
  return (
    <ReconcileSheet
      open={open}
      onOpenChange={setOpen}
      ruang="pribadi"
      account={{ id: 'a1', name: 'BCA', balance }}
      source={source}
      onSaved={onSaved}
      onStale={onStale}
    />
  );
}

const input = () => screen.getByRole('textbox', { name: 'Saldo sebenarnya' });
const submit = () => screen.getByRole('button', { name: /Cocokkan saldo|Coba lagi/ });

describe('ReconcileSheet (S7-W1)', () => {
  it('judul dengan nama dompet dan ruang; saldo di DompetKu; fokus awal di Saldo sebenarnya', async () => {
    render(<Harness />);
    expect(await screen.findByRole('dialog', { name: /Cocokkan saldo · BCA/ })).toBeTruthy();
    expect(screen.getByText('Saldo di DompetKu')).toBeTruthy();
    expect(screen.getAllByText(/1\.250\.000/).length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(input());
  });

  it('kosong: pratinjau kosong dan tombol aria-disabled dengan alasan', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByRole('dialog');
    expect(submit()).toHaveAttribute('aria-disabled', 'true');
    expect(submit().getAttribute('aria-describedby')).toBeTruthy();
    await user.click(submit());
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('lebih besar: Selisih +Rp dan penjelasan naik (tanda dan kata, bukan warna saja)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByRole('dialog');
    await user.type(input(), '1500000');
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(/Selisih\s*\+Rp\s*250\.000/);
    expect(status).toHaveTextContent(
      'Akan dicatat penyesuaian naik. Pemasukan dan pengeluaran tidak berubah.',
    );
    expect(submit()).not.toHaveAttribute('aria-disabled');
  });

  it('lebih kecil: Selisih −Rp dan penjelasan turun', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByRole('dialog');
    await user.type(input(), '1200000');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/Selisih\s*−Rp\s*50\.000/);
    expect(status).toHaveTextContent(
      'Akan dicatat penyesuaian turun. Pemasukan dan pengeluaran tidak berubah.',
    );
  });

  it('sama: Saldo sudah sama dan tombol aria-disabled yang merujuk pratinjau; klik tidak mengirim', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByRole('dialog');
    await user.type(input(), '1250000');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Saldo sudah sama. Tidak ada yang perlu dicocokkan.');
    expect(submit()).toHaveAttribute('aria-disabled', 'true');
    expect(submit()).toHaveAttribute('aria-describedby', status.id);
    await user.click(submit());
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('sukses: kirim saldo nyata + clientId; onSaved membawa selisih dari server; sheet menutup', async () => {
    const user = userEvent.setup();
    // Saldo berubah di antara pratinjau (+250.000) dan simpan: server melaporkan selisih sebenarnya.
    reconcile.mockResolvedValue({ ok: true, value: { entryId: 'adj-1', difference: 300_000 } });
    render(<Harness />);
    await screen.findByRole('dialog');
    await user.type(input(), '1500000');
    await user.click(submit());
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ entryId: 'adj-1', difference: 300_000 });
    });
    expect(reconcile).toHaveBeenCalledWith({
      clientId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      accountId: 'a1',
      actualBalance: 1_500_000,
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('galat jaringan: peringatan + Coba lagi memakai clientId yang sama', async () => {
    const user = userEvent.setup();
    reconcile
      .mockRejectedValueOnce(new Error('putus'))
      .mockResolvedValue({ ok: true, value: { entryId: 'adj-1', difference: 250_000 } });
    render(<Harness />);
    await screen.findByRole('dialog');
    await user.type(input(), '1500000');
    await user.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('Koneksi terputus saat mengirim');
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => {
      expect(reconcile).toHaveBeenCalledTimes(2);
    });
    const [a, b] = reconcile.mock.calls as [[{ clientId: string }], [{ clientId: string }]];
    expect(b[0].clientId).toBe(a[0].clientId);
  });

  it('account_archived: kotak peringatan tanpa nominal dan tanpa Coba lagi', async () => {
    const user = userEvent.setup();
    reconcile.mockResolvedValue({ ok: false, error: { code: 'account_archived' } });
    render(<Harness />);
    await screen.findByRole('dialog');
    await user.type(input(), '1500000');
    await user.click(submit());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('BCA sudah diarsipkan.');
    expect(alert.textContent).not.toMatch(/\d{3}/);
    expect(screen.queryByRole('button', { name: 'Coba lagi' })).toBeNull();
  });

  it('idem_mismatch: pesan mungkin sudah tersimpan, onStale memuat ulang, tanpa Coba lagi', async () => {
    const user = userEvent.setup();
    reconcile.mockResolvedValue({ ok: false, error: { code: 'idem_mismatch' } });
    render(<Harness />);
    await screen.findByRole('dialog');
    await user.type(input(), '1500000');
    await user.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('mungkin sudah tersimpan');
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Coba lagi' })).toBeNull();
  });
});
