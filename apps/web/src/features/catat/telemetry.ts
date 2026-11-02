import type { Ruang } from '@/features/ledger/types';
import { newClientId } from './client-id';
import type { CatatTrackEvent } from './source';

/**
 * Telemetri Catat (PRD §3, §7): ketukan pointer dari tombol Catat sampai Simpan dan durasi alur.
 * Murni dan tanpa isi pengguna: yang tercatat hanya `flowId` (UUID acak per pembukaan sheet,
 * bukan `clientId`), jumlah ketukan, dan durasi. Dimuat bersama sheet (malas), bukan di shell.
 */

export interface CatatTelemetry {
  flowId: string;
  openedAt: number;
  taps: number;
}

const MAX_TAPS = 100;
const MAX_DURATION_MS = 3_600_000;

/** Elemen yang dihitung sebagai satu ketukan. Field teks (MoneyInput, Keterangan) tidak termasuk. */
const INTERACTIVE = 'button, [role="radio"], [role="option"], [role="menuitem"], select, a';

/** Tombol keypad aplikasi: mengetik nominal bukan ketukan alur. */
const KEYPAD = '[data-keypad-digit]';

/** Ketukan awal: 1 bila sheet dibuka dengan pointer, 0 bila dengan pintasan `c`. */
export function startTelemetry(via: 'pointer' | 'shortcut', now: number): CatatTelemetry {
  return { flowId: newClientId(), openedAt: now, taps: via === 'pointer' ? 1 : 0 };
}

/** Satu `click`: dihitung bila dari pointer (`detail > 0`) pada elemen interaktif non-keypad. */
export function countTap(
  t: CatatTelemetry,
  e: { detail: number; target: Element },
): CatatTelemetry {
  if (e.detail <= 0) return t; // Enter/spasi/aktivasi keyboard
  if (e.target.closest(KEYPAD) !== null) return t;
  if (e.target.closest(INTERACTIVE) === null) return t;
  return { ...t, taps: t.taps + 1 };
}

export function finishTelemetry(
  t: CatatTelemetry,
  now: number,
): { flowId: string; taps: number; durationMs: number } {
  return {
    flowId: t.flowId,
    taps: Math.min(Math.max(Math.trunc(t.taps), 0), MAX_TAPS),
    durationMs: Math.min(Math.max(Math.round(now - t.openedAt), 0), MAX_DURATION_MS),
  };
}

export interface CatatFlow {
  readonly flowId: string;
  /** `catat_dibuka`; sekali per alur. */
  open(): void;
  tap(e: { detail: number; target: Element }): void;
  /** Ruang sheet berubah (pindah ruang): event berikutnya memakai ruang ini. */
  setRuang(ruang: Ruang): void;
  /** Simpan sukses: `catat_disimpan` sekali per alur (replay/simpan ulang tidak mengirim lagi). */
  saved(): void;
  /** Sheet ditutup tanpa simpan: `catat_batal` sekali per alur, tidak pernah sesudah disimpan. */
  cancel(): void;
}

/** Satu alur = satu kali sheet dibuka. `track` kirim-dan-lupakan; kegagalannya tidak menyentuh UI. */
export function createCatatFlow(args: {
  via: 'pointer' | 'shortcut';
  ruang: Ruang;
  track?: ((e: CatatTrackEvent) => void) | undefined;
  now?: () => number;
}): CatatFlow {
  const now = args.now ?? Date.now;
  let t = startTelemetry(args.via, now());
  let ruang = args.ruang;
  let opened = false;
  let done = false;

  const send = (e: CatatTrackEvent) => {
    try {
      // Sumber nyata mengembalikan promise di balik tipe `void`; tolakannya ditelan.
      const r: unknown = args.track?.(e);
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      // Telemetri tidak boleh mengganggu Catat.
    }
  };
  const finish = (event: 'catat_disimpan' | 'catat_batal') => {
    if (done) return;
    done = true;
    send({ event, ruang, ...finishTelemetry(t, now()) });
  };

  return {
    flowId: t.flowId,
    open() {
      if (opened) return;
      opened = true;
      send({ event: 'catat_dibuka', ruang, flowId: t.flowId });
    },
    tap(e) {
      if (!done) t = countTap(t, e);
    },
    setRuang(next) {
      ruang = next;
    },
    saved() {
      finish('catat_disimpan');
    },
    cancel() {
      finish('catat_batal');
    },
  };
}
