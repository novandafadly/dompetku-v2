import { createDemoStore, createSeed, safeToSpend } from '@dompetku/demo-data';
import type { Ruang } from '@dompetku/demo-data';
import { formatRupiah } from '@dompetku/domain';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CatatSheet } from './catat-sheet';
import { demoCatatSource } from './demo-source';
import type { CatatSource } from './source';

const TODAY = '2026-10-17';

function setup(ruang: Ruang = 'pribadi', wrap?: (s: CatatSource) => CatatSource) {
  const store = createDemoStore(createSeed({ today: TODAY, variant: 'full' }), {
    clock: () => '2026-10-17T12:00:00+07:00',
  });
  const base = demoCatatSource(store.getState(), store);
  const source = wrap ? wrap(base) : base;
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <CatatSheet
        open={open}
        onOpenChange={setOpen}
        ruang={ruang}
        source={source}
        today={TODAY}
        keypad="os"
        hourWIB={12}
      />
    );
  }
  render(<Host />);
  return { store };
}

afterEach(cleanup);

describe('CatatSheet · Aman dipakai saat ini (konteks, bukan perkiraan)', () => {
  it('pengeluaran Pribadi menampilkan angka Aman dipakai ruang ini dari sumber, per hari ikut', async () => {
    const { store } = setup('pribadi');
    const r = safeToSpend(store.getState(), 'pribadi', TODAY);
    const line = await screen.findByText(/^Aman dipakai/);
    expect(line.textContent).toContain(formatRupiah(r.total));
    expect(line.textContent).toContain(formatRupiah(r.perDay));
  });

  it('tidak menyatakan angka sesudah simpan: mengetik nominal tidak mengubah angkanya', async () => {
    const user = userEvent.setup();
    const { store } = setup('pribadi');
    const r = safeToSpend(store.getState(), 'pribadi', TODAY);
    const before = (await screen.findByText(/^Aman dipakai/)).textContent;
    await user.type(screen.getByRole('textbox', { name: 'Nominal' }), '25000');
    expect(screen.getByText(/^Aman dipakai/).textContent).toBe(before);
    expect(screen.getByText(/^Aman dipakai/).textContent).toContain(formatRupiah(r.total));
    expect(screen.queryByText(/jadi/i)).toBeNull();
  });

  it('sumber asinkron (mode nyata): baris tampil setelah angka tiba', async () => {
    setup('bersama', (s) => ({
      ...s,
      safeToSpend: () => Promise.resolve({ aman: 750_000, perDay: 50_000, daysLeft: 15 }),
    }));
    const line = await screen.findByText(/^Aman dipakai/);
    expect(line.textContent).toContain(formatRupiah(750_000));
    expect(line.textContent).toContain(formatRupiah(50_000));
  });

  it('sumber tanpa angka (null) atau gagal: tidak ada baris, Catat tetap bisa dipakai', async () => {
    setup('pribadi', (s) => ({ ...s, safeToSpend: () => Promise.reject(new Error('putus')) }));
    expect(screen.getByRole('textbox', { name: 'Nominal' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText(/^Aman dipakai/)).toBeNull();
    });
  });

  it('negatif memakai tanda minus dan penanda teks, bukan warna saja', async () => {
    setup('pribadi', (s) => ({
      ...s,
      safeToSpend: () => ({ aman: -26_000, perDay: -2_000, daysLeft: 13 }),
    }));
    const line = await screen.findByText(/^Aman dipakai/);
    expect(line.textContent).toContain(formatRupiah(-26_000));
    expect(line.textContent).toMatch(/kurang dari kewajiban/i);
  });

  it('pemasukan tidak menampilkan baris', async () => {
    const user = userEvent.setup();
    setup('pribadi');
    await screen.findByText(/^Aman dipakai/);
    await user.click(screen.getByRole('button', { name: 'Pengeluaran · Pribadi' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Pemasukan' }));
    expect(screen.queryByText(/^Aman dipakai/)).toBeNull();
  });
});
