import { describe, expect, it, vi } from 'vitest';
import type { CatatTrackEvent } from './source';
import { countTap, createCatatFlow, finishTelemetry, startTelemetry } from './telemetry';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function el(html: string, pick: string): Element {
  const root = document.createElement('div');
  root.innerHTML = html;
  const found = root.querySelector(pick);
  if (found === null) throw new Error(`tidak ada ${pick}`);
  return found;
}

const SHEET = `
  <button id="chip" role="radio" aria-checked="false">Makan</button>
  <button id="simpan" type="submit">Simpan</button>
  <button id="digit" data-keypad-digit>5</button>
  <button id="hapus" data-keypad-digit aria-label="Hapus"><svg><path /></svg></button>
  <input id="nominal" inputmode="numeric" />
  <select id="dompet"><option id="opt">BCA</option></select>
  <div role="listbox"><div id="cmdk" role="option">Kopi</div></div>
  <div role="menu"><button id="item" role="menuitem">Pemasukan</button></div>
  <a id="tautan" href="/x">x</a>
  <p id="teks">teks</p>`;

const tap = (t: ReturnType<typeof startTelemetry>, pick: string, detail = 1) =>
  countTap(t, { detail, target: el(SHEET, pick) });

describe('startTelemetry', () => {
  it('flowId UUID v4 baru per pembukaan; ketukan awal 1 (pointer) atau 0 (pintasan c)', () => {
    const a = startTelemetry('pointer', 1000);
    const b = startTelemetry('pointer', 1000);
    expect(a.flowId).toMatch(UUID);
    expect(a.flowId).not.toBe(b.flowId);
    expect(a.taps).toBe(1);
    expect(a.openedAt).toBe(1000);
    expect(startTelemetry('shortcut', 1000).taps).toBe(0);
  });
});

describe('countTap', () => {
  it('Catat, chip, Simpan = 3 ketukan', () => {
    let t = startTelemetry('pointer', 0);
    t = tap(t, '#chip');
    t = tap(t, '#simpan');
    expect(t.taps).toBe(3);
  });

  it('lewat pintasan c: chip, Simpan = 2 ketukan', () => {
    let t = startTelemetry('shortcut', 0);
    t = tap(t, '#chip');
    t = tap(t, '#simpan');
    expect(t.taps).toBe(2);
  });

  it('menghitung radio, option, menuitem, select, tautan, dan anak elemen interaktif', () => {
    let t = startTelemetry('shortcut', 0);
    for (const pick of ['#chip', '#cmdk', '#item', '#dompet', '#tautan', '#hapus path']) {
      const before = t.taps;
      t = tap(t, pick);
      // #hapus path ada di keypad: tidak dihitung; lainnya +1
      expect(t.taps).toBe(pick === '#hapus path' ? before : before + 1);
    }
  });

  it('ketik nominal lewat keypad aplikasi tidak menambah', () => {
    let t = startTelemetry('pointer', 0);
    t = tap(t, '#digit');
    t = tap(t, '#digit');
    t = tap(t, '#hapus');
    expect(t.taps).toBe(1);
  });

  it('klik di field nominal dan area non-interaktif tidak menambah', () => {
    let t = startTelemetry('pointer', 0);
    t = tap(t, '#nominal');
    t = tap(t, '#teks');
    expect(t.taps).toBe(1);
  });

  it('aktivasi keyboard (detail 0), mis. Enter di nominal atau spasi di chip, tidak menambah', () => {
    let t = startTelemetry('pointer', 0);
    t = tap(t, '#simpan', 0);
    t = tap(t, '#chip', 0);
    expect(t.taps).toBe(1);
  });

  it('tidak mengubah objek lama', () => {
    const t = startTelemetry('pointer', 0);
    countTap(t, { detail: 1, target: el(SHEET, '#chip') });
    expect(t.taps).toBe(1);
  });
});

describe('finishTelemetry', () => {
  it('payload hanya flowId, taps, durationMs', () => {
    const t = startTelemetry('pointer', 1000);
    const out = finishTelemetry(t, 4500);
    expect(Object.keys(out).sort()).toEqual(['durationMs', 'flowId', 'taps']);
    expect(out).toEqual({ flowId: t.flowId, taps: 1, durationMs: 3500 });
  });

  it('taps dibatasi 100 dan durasi 3600000', () => {
    const t = { ...startTelemetry('pointer', 0), taps: 250 };
    expect(finishTelemetry(t, 99_999_999)).toMatchObject({ taps: 100, durationMs: 3_600_000 });
  });

  it('durasi bulat dan tidak negatif', () => {
    const t = startTelemetry('pointer', 1000);
    expect(finishTelemetry(t, 900).durationMs).toBe(0);
    expect(finishTelemetry(t, 1000.6).durationMs).toBe(1);
  });
});

describe('createCatatFlow', () => {
  function setup(via: 'pointer' | 'shortcut' = 'pointer') {
    const events: CatatTrackEvent[] = [];
    let now = 0;
    const flow = createCatatFlow({
      via,
      ruang: 'pribadi',
      now: () => now,
      track: (e) => events.push(e),
    });
    return {
      flow,
      events,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }
  const click = (pick: string) => ({ detail: 1, target: el(SHEET, pick) });

  it('catat_dibuka sekali walau open dipanggil lagi (mode ketat React)', () => {
    const { flow, events } = setup();
    flow.open();
    flow.open();
    expect(events).toEqual([{ event: 'catat_dibuka', ruang: 'pribadi', flowId: flow.flowId }]);
  });

  it('simpan sukses = catat_disimpan dengan taps dan durasi', () => {
    const { flow, events, advance } = setup();
    flow.open();
    flow.tap(click('#chip'));
    advance(2500);
    flow.tap(click('#simpan'));
    flow.saved();
    expect(events[1]).toEqual({
      event: 'catat_disimpan',
      ruang: 'pribadi',
      flowId: flow.flowId,
      taps: 3,
      durationMs: 2500,
    });
  });

  it('simpan ulang (replay) tidak mengirim catat_disimpan kedua', () => {
    const { flow, events } = setup();
    flow.open();
    flow.saved();
    flow.saved();
    expect(events.filter((e) => e.event === 'catat_disimpan')).toHaveLength(1);
  });

  it('batal sekali per flow; tidak sesudah disimpan', () => {
    const a = setup();
    a.flow.open();
    a.flow.cancel();
    a.flow.cancel();
    expect(a.events.filter((e) => e.event === 'catat_batal')).toHaveLength(1);

    const b = setup();
    b.flow.open();
    b.flow.saved();
    b.flow.cancel();
    expect(b.events.map((e) => e.event)).toEqual(['catat_dibuka', 'catat_disimpan']);
  });

  it('tidak ada ketukan dihitung sesudah selesai; ruang terakhir dipakai di event', () => {
    const { flow, events } = setup('shortcut');
    flow.open();
    flow.setRuang('bersama');
    flow.tap(click('#chip'));
    flow.cancel();
    flow.tap(click('#chip'));
    expect(events[1]).toMatchObject({ event: 'catat_batal', ruang: 'bersama', taps: 1 });
  });

  it('payload event tidak memuat nominal, deskripsi, atau id selain flowId', () => {
    const { flow, events } = setup();
    flow.open();
    flow.saved();
    for (const e of events) {
      expect(Object.keys(e).sort()).toEqual(
        e.event === 'catat_dibuka'
          ? ['event', 'flowId', 'ruang']
          : ['durationMs', 'event', 'flowId', 'ruang', 'taps'],
      );
    }
  });

  it('track yang melempar tidak merusak alur', () => {
    const track = vi.fn(() => {
      throw new Error('putus');
    });
    const flow = createCatatFlow({ via: 'pointer', ruang: 'pribadi', track });
    expect(() => {
      flow.open();
      flow.saved();
      flow.cancel();
    }).not.toThrow();
    expect(track).toHaveBeenCalledTimes(2);
  });

  it('track yang mengembalikan promise tertolak tidak menjadi unhandled rejection', async () => {
    const flow = createCatatFlow({
      via: 'pointer',
      ruang: 'pribadi',
      track: () => Promise.reject(new Error('putus')) as unknown as undefined,
    });
    flow.open();
    await Promise.resolve();
  });

  it('tanpa track (opsional) tetap aman', () => {
    const flow = createCatatFlow({ via: 'pointer', ruang: 'pribadi' });
    expect(() => {
      flow.open();
      flow.tap(click('#chip'));
      flow.saved();
    }).not.toThrow();
  });
});
