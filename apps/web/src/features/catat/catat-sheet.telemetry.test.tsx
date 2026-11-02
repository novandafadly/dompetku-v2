import { createDemoStore, createSeed } from '@dompetku/demo-data';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CatatSheet } from './catat-sheet';
import { demoCatatSource } from './demo-source';
import type { CatatSource, CatatTrackEvent, SaveOutcome } from './source';

const TODAY = '2026-10-17';

function setup(opts: {
  via?: 'pointer' | 'shortcut';
  keypad?: 'os' | 'app';
  save?: (src: CatatSource['save']) => CatatSource['save'];
  /** `track` mencatat lalu melempar: Catat tidak boleh terganggu. */
  throwing?: boolean;
}) {
  const store = createDemoStore(createSeed({ today: TODAY, variant: 'full' }), {
    clock: () => '2026-10-17T12:00:00+07:00',
  });
  const events: CatatTrackEvent[] = [];
  const base = demoCatatSource(store.getState(), store);
  const baseSave: CatatSource['save'] = (d) => base.save(d);
  const source: CatatSource = {
    ...base,
    save: opts.save?.(baseSave) ?? baseSave,
    track: (e) => {
      events.push(e);
      if (opts.throwing === true) throw new Error('telemetri putus');
    },
  };
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          buka lagi
        </button>
        <CatatSheet
          open={open}
          onOpenChange={setOpen}
          ruang="pribadi"
          source={source}
          today={TODAY}
          keypad={opts.keypad ?? 'os'}
          hourWIB={12}
          {...(opts.via === undefined ? {} : { via: opts.via })}
        />
      </>
    );
  }
  render(<Host />);
  return { events };
}

afterEach(cleanup);

async function firstChip() {
  const chip = (await screen.findAllByRole('radio'))[0];
  if (chip === undefined) throw new Error('tidak ada chip');
  return chip;
}

async function typeAmount(user: ReturnType<typeof userEvent.setup>, digits: string) {
  await user.type(screen.getByRole('textbox', { name: 'Nominal' }), digits);
}

describe('CatatSheet telemetri', () => {
  it('Catat, chip, Simpan = 3 ketukan; hanya dibuka lalu disimpan, tanpa data pengguna', async () => {
    const user = userEvent.setup();
    const { events } = setup({ via: 'pointer' });
    await typeAmount(user, '25000');
    await user.type(screen.getByLabelText(/Keterangan/), 'kopi sore rahasia');
    const chip = await firstChip();
    const kategori = chip.textContent;
    await user.click(chip);
    await user.click(screen.getByRole('button', { name: /^Simpan/ }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // Beri kesempatan efek penutupan berjalan: tidak boleh ada catat_batal sesudah disimpan.
    await new Promise((r) => setTimeout(r, 30));
    expect(events.map((e) => e.event)).toEqual(['catat_dibuka', 'catat_disimpan']);
    expect(events[1]).toMatchObject({ event: 'catat_disimpan', ruang: 'pribadi', taps: 3 });
    // Bentuk persis: kunci tetap, tanpa nominal, keterangan, nama kategori, atau id.
    expect(events.map((e) => Object.keys(e).sort())).toEqual([
      ['event', 'flowId', 'ruang'],
      ['durationMs', 'event', 'flowId', 'ruang', 'taps'],
    ]);
    expect(events[0]?.flowId).toBe(events[1]?.flowId);
    const json = JSON.stringify(events);
    expect(json).not.toContain('25000');
    expect(json).not.toContain('rahasia');
    expect(kategori).toBeTruthy();
    expect(json).not.toContain(kategori);
  });

  it('via pintasan c = 2 ketukan', async () => {
    const user = userEvent.setup();
    const { events } = setup({ via: 'shortcut' });
    await typeAmount(user, '25000');
    await user.click(await firstChip());
    await user.click(screen.getByRole('button', { name: /^Simpan/ }));
    await waitFor(() => {
      expect(events).toHaveLength(2);
    });
    expect(events[1]).toMatchObject({ event: 'catat_disimpan', taps: 2 });
  });

  it('keypad aplikasi dan Enter tidak menambah ketukan', async () => {
    const user = userEvent.setup();
    const { events } = setup({ via: 'pointer', keypad: 'app' });
    for (const d of ['2', '5', '000']) await user.click(screen.getByRole('button', { name: d }));
    await user.click(await firstChip());
    // Aktivasi keyboard pada Simpan: klik dengan detail 0 (sama dengan Enter di field nominal).
    screen.getByRole('button', { name: /^Simpan/ }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(events).toHaveLength(2);
    });
    expect(events[1]).toMatchObject({ event: 'catat_disimpan', taps: 2 });
  });

  it('ditutup tanpa simpan = catat_batal sekali', async () => {
    const user = userEvent.setup();
    const { events } = setup({});
    await user.click(screen.getByRole('button', { name: 'Tutup' }));
    await waitFor(() => {
      expect(events.map((e) => e.event)).toEqual(['catat_dibuka', 'catat_batal']);
    });
    expect(events[1]).toMatchObject({ taps: 2 });
  });

  it('dibuka lagi = alur baru dengan flowId baru', async () => {
    const user = userEvent.setup();
    const { events } = setup({});
    await user.click(screen.getByRole('button', { name: 'Tutup' }));
    await user.click(screen.getByRole('button', { name: 'buka lagi' }));
    await waitFor(() => {
      expect(events).toHaveLength(3);
    });
    expect(events.map((e) => e.event)).toEqual(['catat_dibuka', 'catat_batal', 'catat_dibuka']);
    expect(events[2]?.flowId).not.toBe(events[0]?.flowId);
  });

  it('galat lalu Coba lagi (replay) menghasilkan satu catat_disimpan, tanpa batal', async () => {
    const user = userEvent.setup();
    const { events } = setup({
      save: (real) => {
        let n = 0;
        return async (d): Promise<SaveOutcome> => {
          if (n++ === 0) return { ok: false, code: 'network' };
          const out = await real(d);
          return out.ok ? { ...out, replayed: true } : out;
        };
      },
    });
    await typeAmount(user, '25000');
    await user.click(await firstChip());
    await user.click(screen.getByRole('button', { name: /^Simpan/ }));
    await user.click(await screen.findByRole('button', { name: /Coba lagi/ }));
    await waitFor(() => {
      expect(events.map((e) => e.event)).toContain('catat_disimpan');
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(events.map((e) => e.event)).toEqual(['catat_dibuka', 'catat_disimpan']);
    expect(events[1]).toMatchObject({ taps: 4 });
  });

  it('track yang melempar tidak merusak simpan: sheet tertutup dan satu catat_disimpan', async () => {
    const user = userEvent.setup();
    const { events } = setup({ throwing: true });
    await typeAmount(user, '25000');
    await user.click(await firstChip());
    await user.click(screen.getByRole('button', { name: /^Simpan/ }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(events.map((e) => e.event)).toEqual(['catat_dibuka', 'catat_disimpan']);
  });

  it('dilepas dari pohon sebelum simpan = catat_batal', async () => {
    const { events } = setup({});
    expect(events.map((e) => e.event)).toEqual(['catat_dibuka']);
    cleanup();
    await waitFor(() => {
      expect(events.map((e) => e.event)).toEqual(['catat_dibuka', 'catat_batal']);
    });
  });
});
