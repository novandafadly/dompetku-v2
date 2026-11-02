import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { EntryVM } from '@/features/ledger/types';
import { ENTRY, renderEdit, UUID_V4 } from '@/test/edit-kit';

afterEach(cleanup);

async function setAmount(user: ReturnType<typeof userEvent.setup>, digits: string) {
  const input = screen.getByRole('textbox', { name: 'Nominal' });
  await user.clear(input);
  await user.type(input, digits);
}

const save = () => screen.getByRole('button', { name: /Simpan perubahan/ });

describe('EditSheet (S6-D1)', () => {
  it('judul Ubah transaksi, isian terisi nilai sekarang, kategori entri terpilih di chip pertama', async () => {
    renderEdit();
    expect(await screen.findByRole('dialog', { name: 'Ubah transaksi' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Nominal' })).toHaveProperty('value', '50.000');
    const chips = screen.getAllByRole('radio');
    expect(chips[0]?.textContent).toContain('Kesehatan');
    expect(chips[0]?.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText(/Keterangan/)).toHaveProperty('value', 'Vitamin');
    // Jenis tidak bisa diganti; tidak ada pindah ruang di mode Ubah.
    expect(screen.getByText('Pengeluaran')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Pindah ke/ })).toBeNull();
  });

  it('ganti-penuh: field yang tidak diubah tetap dikirim dengan nilai sekarang', async () => {
    const user = userEvent.setup();
    const { update, onSaved } = renderEdit();
    await setAmount(user, '60000');
    await user.click(save());
    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    const sent = update.mock.calls[0]?.[0];
    expect(sent).toEqual({
      clientId: expect.stringMatching(UUID_V4) as unknown,
      entryId: ENTRY.id,
      expectedVersion: 2,
      accountId: 'a-bca',
      amount: 60_000,
      categoryId: 'c-kesehatan',
      occurredOn: '2026-10-30',
      description: 'Vitamin',
      reimbursable: true,
      allowNegative: false,
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(3);
    });
  });

  it('deskripsi dikosongkan dikirim null', async () => {
    const user = userEvent.setup();
    const { update } = renderEdit();
    await user.clear(screen.getByLabelText(/Keterangan/));
    await user.click(save());
    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    expect(update.mock.calls[0]?.[0]).toMatchObject({ description: null, amount: 50_000 });
  });

  it('galat jaringan lalu Coba lagi memakai clientId yang sama', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const { update } = renderEdit({
      update: () =>
        Promise.resolve(
          ++calls === 1
            ? { ok: false, error: { code: 'network' } }
            : { ok: true, value: { entryId: ENTRY.id, version: 3 } },
        ),
    });
    await setAmount(user, '55000');
    await user.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Coba lagi tidak akan mencatat dua kali.',
    );
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
    });
    const [first, second] = update.mock.calls.map((c) => c[0]);
    expect(second?.clientId).toBe(first?.clientId);
    expect(second).toEqual(first);
  });

  it('saldo kurang (S6-C3): Tetap simpan mengirim allowNegative dengan clientId sama', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const { update } = renderEdit({
      update: () =>
        Promise.resolve(
          ++calls === 1
            ? { ok: false, error: { code: 'saldo_negatif' } }
            : { ok: true, value: { entryId: ENTRY.id, version: 3 } },
        ),
    });
    await setAmount(user, '1100000');
    await user.click(save());
    // BCA 1.000.000 + 50.000 lama dikembalikan, dikurangi 1.100.000 baru.
    expect(
      await screen.findByText(
        'Saldo BCA tinggal Rp 1.000.000. Kalau disimpan, saldonya jadi −Rp 50.000.',
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Tetap simpan/ }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
    });
    const [first, second] = update.mock.calls.map((c) => c[0]);
    expect(second).toEqual({ ...first, allowNegative: true });
  });

  it('saldo awal: hanya nominal yang bisa diubah, kolom lain dikirim apa adanya', async () => {
    const user = userEvent.setup();
    const opening: EntryVM = {
      id: ENTRY.id,
      version: 1,
      kind: 'opening_balance',
      occurredOn: '2026-10-28',
      createdAt: '2026-10-28T08:00:00+07:00',
      createdBy: ENTRY.createdBy,
      accountId: 'a-bca',
      accountName: 'BCA',
      amount: 50_000,
    };
    const { update } = renderEdit({ entry: opening });
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByLabelText(/Keterangan/)).toBeNull();
    expect(screen.queryByRole('combobox', { name: /dompet/i })).toBeNull();
    await setAmount(user, '75000');
    await user.click(save());
    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      accountId: 'a-bca',
      amount: 75_000,
      categoryId: null,
      occurredOn: '2026-10-28',
      description: null,
      reimbursable: false,
    });
  });

  it('tanpa perubahan: Simpan perubahan menutup sheet tanpa memanggil server', async () => {
    const user = userEvent.setup();
    const { update } = renderEdit();
    await user.click(save());
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(update).not.toHaveBeenCalled();
  });
});
