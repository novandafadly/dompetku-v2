// Memadukan penanda tanggal parser dengan hari ini (spec 4.1). Murni: `today` = `app.today()` dari
// DB (WIB), supaya tanggal "masa depan" sama dengan yang ditolak ledger (`private.check_date`).
import { addDays, daysInclusive, type IsoDate } from '@dompetku/domain';
import type { DateSpec } from './parse';

export type DateResolution =
  { ok: true; iso: IsoDate } | { ok: false; reason: 'future' | 'invalid' | 'too_old' };

const MIN_DATE = '2000-01-01';
const FUTURE_WINDOW_DAYS = 183;
/**
 * Batas mundur dari WhatsApp (hasil tinjauan keamanan 2026-11-11): lebih lama dari ini = "catat dari
 * app". Menutup salah ketik tahun (`tgl 9/11/2015`) dan entri palsu yang menyembunyikan diri di
 * periode lama; ledger sendiri hanya menolak sebelum 2000-01-01.
 */
export const MAX_BACK_DAYS = 366;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
}

function parts(d: IsoDate): { y: number; m: number; d: number } {
  return { y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) };
}

/**
 * - `ago`: hari ini dikurangi n.
 * - `day` (`tgl 9`): kejadian terakhir yang <= hari ini; bulan tanpa tanggal itu dilewati.
 * - `dm` (`tgl 9/11`, `tgl 9 nov`): tahun ini bila sudah terjadi; bila belum dan jaraknya <= 183 hari =
 *   `future` (salah ketik, tidak diam-diam mundur setahun); bila lebih jauh = tahun lalu (`tgl 28/12`
 *   di awal Januari). 29 Februari mencari tahun kabisat terakhir.
 * - `full`: apa adanya; sesudah hari ini = `future`, sebelum 2000 = `invalid` (batas DB).
 */
function resolveRaw(spec: DateSpec, today: IsoDate): DateResolution {
  const t = parts(today);
  switch (spec.kind) {
    case 'ago':
      return { ok: true, iso: addDays(today, -spec.days) };
    case 'full': {
      const v = iso(spec.year, spec.month, spec.day);
      if (v > today) return { ok: false, reason: 'future' };
      if (v < MIN_DATE) return { ok: false, reason: 'invalid' };
      return { ok: true, iso: v };
    }
    case 'dm': {
      for (let y = t.y; y >= t.y - 8; y--) {
        if (spec.day > daysIn(y, spec.month)) {
          // 29 Februari di tahun tanpa tanggal itu: kabisat berikutnya yang dekat = salah ketik.
          if (y === t.y) {
            for (let n = y + 1; n <= y + 4; n++) {
              if (spec.day <= daysIn(n, spec.month)) {
                if (daysInclusive(today, iso(n, spec.month, spec.day)) - 1 <= FUTURE_WINDOW_DAYS) {
                  return { ok: false, reason: 'future' };
                }
                break;
              }
            }
          }
          continue;
        }
        const v = iso(y, spec.month, spec.day);
        if (v <= today) return { ok: true, iso: v };
        // Belum terjadi: dekat (<= 183 hari) = salah ketik, ditolak; jauh = tahun lalu (mis. "tgl 28/12"
        // yang dicatat awal Januari).
        if (daysInclusive(today, v) - 1 <= FUTURE_WINDOW_DAYS)
          return { ok: false, reason: 'future' };
      }
      return { ok: false, reason: 'invalid' };
    }
    case 'day': {
      let y = t.y;
      let m = t.m;
      for (let i = 0; i < 14; i++) {
        if (spec.day <= daysIn(y, m)) {
          const v = iso(y, m, spec.day);
          if (v <= today) return { ok: true, iso: v };
        }
        m -= 1;
        if (m === 0) {
          m = 12;
          y -= 1;
        }
      }
      return { ok: false, reason: 'invalid' };
    }
  }
}

export function resolveDate(spec: DateSpec, today: IsoDate): DateResolution {
  const res = resolveRaw(spec, today);
  if (res.ok && res.iso < addDays(today, -MAX_BACK_DAYS)) return { ok: false, reason: 'too_old' };
  return res;
}
