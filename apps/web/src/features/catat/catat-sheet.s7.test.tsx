import { createDemoStore, createSeed } from '@dompetku/demo-data';
import type { Ruang } from '@dompetku/demo-data';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
  return { store, source };
}

afterEach(cleanup);

async function toTransfer(user: ReturnType<typeof userEvent.setup>, ruang = 'Pribadi') {
  await user.click(screen.getByRole('button', { name: `Pengeluaran · ${ruang}` }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Transfer' }));
}

describe('CatatSheet · transfer antar ruang (S7-C1)', () => {
  it('Ruang lain… → halaman dompet Bersama → chip terpilih, judul dua ruang, catatan Bersama; simpan membuat dua kaki', async () => {
    const user = userEvent.setup();
    const { store } = setup();
    await toTransfer(user);
    await user.type(screen.getByRole('textbox', { name: 'Nominal' }), '20000');
    // Tanpa tujuan antar ruang tidak ada kolom catatan Bersama.
    expect(screen.queryByLabelText(/Catatan untuk Bersama/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pilih dompet di ruang lain' }));
    expect(await screen.findByRole('heading', { name: 'Ke dompet di Bersama' })).toBeTruthy();
    const group = await screen.findByRole('radiogroup', { name: 'Dompet di Bersama' });
    const rows = within(group).getAllByRole('radio');
    // Tanpa saldo di baris dompet.
    expect(group.textContent).not.toMatch(/Rp/);
    expect(rows.map((r) => r.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Kas Rumah')]),
    );
    await user.click(within(group).getByRole('radio', { name: /Kas Rumah/ }));

    expect(screen.getByRole('dialog', { name: 'Transfer · Pribadi → Bersama' })).toBeTruthy();
    const chosen = screen.getByRole('radio', { name: 'Kas Rumah · Bersama' });
    expect(chosen.getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Tambah keterangan' }));
    expect(screen.getByLabelText(/Keterangan \(hanya di Pribadi\)/)).toBeTruthy();
    await user.type(screen.getByLabelText(/Keterangan \(hanya di Pribadi\)/), 'bayar kos adik');
    const note = screen.getByLabelText(/Catatan untuk Bersama/);
    expect((note as HTMLInputElement).placeholder).toBe('Terlihat oleh Farida di Bersama');
    await user.type(note, 'Setoran bulanan');

    await user.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => {
      expect(
        store.getState().entries.filter((e) => e.sharedNote === 'Setoran bulanan'),
      ).toHaveLength(1);
    });
    const inLeg = store.getState().entries.find((e) => e.sharedNote === 'Setoran bulanan');
    const out = store
      .getState()
      .entries.find((e) => e.linkId === inLeg?.linkId && e.direction === 'out');
    expect(out?.description).toBe('bayar kos adik');
    expect(inLeg?.description).toBeUndefined();
  });

  it('Dari Bersama: halaman menyebut Pribadi; Dompet Kantor tidak ada', async () => {
    const user = userEvent.setup();
    setup('bersama');
    await toTransfer(user, 'Bersama');
    await user.click(screen.getByRole('button', { name: 'Pilih dompet di ruang lain' }));
    const group = await screen.findByRole('radiogroup', { name: 'Dompet di Pribadi' });
    expect(within(group).queryByText(/Kantor/)).toBeNull();
    expect(within(group).getAllByRole('radio').length).toBeGreaterThan(0);
  });

  it('sumber dompet Kantor: Ruang lain… diganti keterangan; dompet Kantor bukan sumber saat antar ruang', async () => {
    const user = userEvent.setup();
    setup();
    await toTransfer(user);
    await user.selectOptions(screen.getByLabelText('Dari dompet'), 'acc-kantor');
    expect(screen.queryByRole('button', { name: 'Pilih dompet di ruang lain' })).toBeNull();
    expect(screen.getByText('Dompet Kantor tidak bisa ikut transfer antar ruang.')).toBeTruthy();
    // Kembali ke dompet biasa, pilih tujuan antar ruang: Kantor hilang dari pilihan sumber.
    await user.selectOptions(screen.getByLabelText('Dari dompet'), 'acc-bca');
    await user.click(screen.getByRole('button', { name: 'Pilih dompet di ruang lain' }));
    await user.click(await screen.findByRole('radio', { name: /Kas Rumah/ }));
    const options = within(screen.getByLabelText('Dari dompet')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).not.toContain('Kantor');
    expect(options.every((o) => !/kantor/i.test(o.textContent))).toBe(true);
  });

  it('Escape di halaman dalam kembali ke sheet utama, tidak menutup sheet', async () => {
    const user = userEvent.setup();
    setup();
    await toTransfer(user);
    await user.click(screen.getByRole('button', { name: 'Pilih dompet di ruang lain' }));
    await screen.findByRole('radiogroup', { name: 'Dompet di Bersama' });
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Transfer · Pribadi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pilih dompet di ruang lain' })).toBeTruthy();
  });

  it('ruang tujuan tanpa dompet: keadaan kosong + Tambah dompet', async () => {
    const user = userEvent.setup();
    setup('pribadi', (s) => ({ ...s, spaceTransferTargets: () => [] }));
    await toTransfer(user);
    await user.click(screen.getByRole('button', { name: 'Pilih dompet di ruang lain' }));
    expect(await screen.findByText('Belum ada dompet di Bersama.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tambah dompet' })).toBeTruthy();
  });

  it('gagal memuat dompet tujuan: galat + Coba lagi memuat ulang', async () => {
    const user = userEvent.setup();
    let fail = true;
    setup('pribadi', (s) => ({
      ...s,
      spaceTransferTargets: (r) =>
        fail ? Promise.reject(new Error('net')) : Promise.resolve(s.spaceTransferTargets(r)),
    }));
    await toTransfer(user);
    await user.click(screen.getByRole('button', { name: 'Pilih dompet di ruang lain' }));
    expect(await screen.findByText(/Dompet belum bisa dimuat/)).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByRole('radiogroup', { name: 'Dompet di Bersama' })).toBeTruthy();
  });
});

describe('CatatSheet · talangan (S7-C2)', () => {
  it('tombol switch hanya pada pengeluaran Pribadi; petunjuk satu baris; reset saat pindah jenis/ruang', async () => {
    const user = userEvent.setup();
    setup();
    const toggle = screen.getByRole('switch', { name: 'Talangan kantor' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByText('Tidak masuk hitungan pribadi. Tercatat di Menunggu reimburse.'),
    ).toBeTruthy();
    // Pindah jenis: tombol hilang; kembali: mati lagi.
    await user.click(screen.getByRole('button', { name: 'Pengeluaran · Pribadi' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Pemasukan' }));
    expect(screen.queryByRole('switch')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pemasukan · Pribadi' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Pengeluaran' }));
    expect(
      screen.getByRole('switch', { name: 'Talangan kantor' }).getAttribute('aria-checked'),
    ).toBe('false');
    // Bersama: tidak ada tombol.
    await user.click(screen.getByRole('button', { name: /Pindah ke Bersama/ }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Pengeluaran · Bersama' })).toBeTruthy();
    });
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('dompet Kantor: tombol hilang; simpan talangan menandai entri dan menyebut di toast', async () => {
    const user = userEvent.setup();
    const { store } = setup();
    await user.type(screen.getByRole('textbox', { name: 'Nominal' }), '50000');
    await user.click(screen.getByRole('switch', { name: 'Talangan kantor' }));
    const [chip] = await screen.findAllByRole('radio');
    if (chip === undefined) throw new Error('tidak ada chip');
    await user.click(chip);
    await user.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => {
      expect(store.getState().entries.at(-1)?.reimbursable).toBe(true);
    });
    cleanup();
    setup();
    await user.selectOptions(screen.getByLabelText('Dari dompet'), 'acc-kantor');
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
