import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportEntriesSheet } from './import-entries-sheet';
import { ArchiveTripDialog } from './trip-dialogs';
import { TripSheet } from './trip-sheet';

afterEach(cleanup);

describe('TripSheet (S15-TR11, TR12)', () => {
  it('validasi klien: nama kosong, selesai kosong, selesai < mulai, rentang > 366 hari', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <TripSheet
        open
        onOpenChange={vi.fn()}
        ruang="pribadi"
        today="2026-12-12"
        trip={null}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Simpan trip' }));
    expect(screen.getByText('Nama trip wajib diisi, paling banyak 60 huruf.')).toBeVisible();
    expect(screen.getByText('Isi tanggal selesai.')).toBeVisible();
    expect(onCreate).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Nama trip'), 'Bali');
    fireEvent.change(screen.getByLabelText('Selesai'), { target: { value: '2026-12-10' } });
    await user.click(screen.getByRole('button', { name: 'Simpan trip' }));
    expect(screen.getByText('Tanggal selesai tidak boleh sebelum tanggal mulai.')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Selesai'), { target: { value: '2027-12-15' } });
    await user.click(screen.getByRole('button', { name: 'Simpan trip' }));
    expect(screen.getByText('Rentang trip paling lama 366 hari.')).toBeVisible();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('memetakan name_taken dan kedua ejaan galat kolom (Zod + DB) tanpa menutup sheet', async () => {
    const user = userEvent.setup();
    const onCreate = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 'name_taken' })
      .mockResolvedValueOnce({ ok: false, code: 'invalid', field: 'starts_on' })
      .mockResolvedValueOnce({ ok: false, code: 'invalid', field: 'budget_amount' })
      .mockResolvedValueOnce({ ok: true, tripId: 't1' });
    const onSaved = vi.fn();
    render(
      <TripSheet
        open
        onOpenChange={vi.fn()}
        ruang="pribadi"
        today="2026-12-12"
        trip={null}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onSaved={onSaved}
      />,
    );
    await user.type(screen.getByLabelText('Nama trip'), 'Bali');
    fireEvent.change(screen.getByLabelText('Selesai'), { target: { value: '2026-12-19' } });

    await user.click(screen.getByRole('button', { name: 'Simpan trip' }));
    expect(screen.getByText('Sudah ada trip aktif bernama Bali di Pribadi.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Simpan trip' }));
    expect(screen.getByText('Isi tanggal mulai yang valid.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Simpan trip' }));
    expect(screen.getByText('Anggaran harus lebih dari nol dan masuk akal.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Simpan trip' }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ tripId: 't1', name: 'Bali', created: true });
    });
    // clientId tetap stabil di semua percobaan ulang pada pembukaan sheet yang sama.
    const ids = onCreate.mock.calls.map((c) => (c[0] as { clientId: string }).clientId);
    expect(new Set(ids).size).toBe(1);
  });

  it('mode Ubah: tanpa perubahan menutup tanpa memanggil server; Hapus anggaran mengirim null', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onUpdate = vi.fn().mockResolvedValue({ ok: true, tripId: 't1' });
    render(
      <TripSheet
        open
        onOpenChange={onOpenChange}
        ruang="bersama"
        today="2026-12-12"
        trip={{
          id: 't1',
          name: 'Lombok',
          startsOn: '2026-12-12',
          endsOn: '2026-12-19',
          budget: 5_000_000,
        }}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onSaved={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Mengubah tanggal tidak memindahkan pengeluaran yang sudah masuk trip.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole('button', { name: 'Hapus anggaran' }));
    await user.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    expect(onUpdate).toHaveBeenCalledWith({
      tripId: 't1',
      name: 'Lombok',
      startsOn: '2026-12-12',
      endsOn: '2026-12-19',
      budget: null,
    });
  });
});

describe('ArchiveTripDialog & ImportEntriesSheet (S15-TR9, TR13)', () => {
  it('ArchiveTripDialog Bersama menampilkan paragraf pasangan; solo tidak', () => {
    const { rerender } = render(
      <ArchiveTripDialog
        open
        onOpenChange={vi.fn()}
        name="Bali"
        ruang="bersama"
        partnerName="Farida"
        busy={false}
        failure={null}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText('Arsipkan Bali?')).toBeVisible();
    expect(screen.getByText('Trip ini juga hilang dari pilihan Farida.')).toBeVisible();

    rerender(
      <ArchiveTripDialog
        open
        onOpenChange={vi.fn()}
        name="Bali"
        ruang="pribadi"
        partnerName={null}
        busy={false}
        failure={null}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText(/hilang dari pilihan Farida/)).toBeNull();
  });

  it('ImportEntriesSheet: menampilkan pratinjau, galat trip_entry_invalid, dan konfirmasi', async () => {
    const user = userEvent.setup();
    const onConfirm = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 'trip_entry_invalid' })
      .mockResolvedValueOnce({ ok: true, changed: 2 });
    const onImported = vi.fn();
    render(
      <ImportEntriesSheet
        open
        onOpenChange={vi.fn()}
        ruang="pribadi"
        tripName="Bali"
        candidates={[
          {
            entryId: 'e1',
            occurredOn: '2026-12-13',
            description: 'Tiket pesawat',
            categoryName: 'Transportasi',
            accountName: 'BCA',
            amount: 1_200_000,
          },
          {
            entryId: 'e2',
            occurredOn: '2026-12-14',
            description: null,
            categoryName: 'Makan',
            accountName: 'Tunai',
            amount: 50_000,
          },
        ]}
        onConfirm={onConfirm}
        onImported={onImported}
      />,
    );
    expect(screen.getByText('Tiket pesawat')).toBeVisible();
    expect(screen.getByText('Makan')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Masukkan 2 pengeluaran' }));
    expect(
      screen.getByText(
        'Ada pengeluaran yang tidak bisa masuk trip lagi. Muat ulang halaman, lalu coba lagi.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Masukkan 2 pengeluaran' }));
    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith({ entryIds: ['e1', 'e2'], changed: 2 });
    });
  });
});
