import type { IsoDate, Rupiah } from '@dompetku/domain';

/**
 * View-model Tujuan tabungan (S13, bingkai `docs/design/s13-bingkai.md`). Dirangkai di server
 * (`server/ledger/tujuan.ts`) dari `api.list_goals`; semua angka (`saved`, `remaining`, `pct`,
 * `reached`, `periodsLeft`, `perPeriod`) datang dari SQL (`app.goal_progress`). UI hanya memilih
 * kalimat dari nilai itu (perbandingan dengan 0/null), tidak menjumlah atau membagi.
 */

export type GoalStatus = 'active' | 'completed' | 'archived';

export interface GoalVM {
  goalId: string;
  name: string;
  accountId: string;
  accountName: string;
  /** Dompetnya sudah diarsipkan: tujuan tidak bisa dipulihkan (dompet tidak bisa dipulihkan). */
  accountArchived: boolean;
  status: GoalStatus;
  target: Rupiah;
  targetOn: IsoDate | null;
  /** ISO WIB `YYYY-MM-DD` hari selesai/diarsip, `null` untuk tujuan aktif. */
  completedOn: IsoDate | null;
  archivedOn: IsoDate | null;
  /** Nama pembuat (hanya Bersama dua anggota); `null` = tidak ditampilkan. */
  createdByName: string | null;
  /** Saldo dompet saat ini (bisa minus). */
  balance: Rupiah;
  /** `max(0, saldo)`. */
  saved: Rupiah;
  /** `max(0, target − saldo)`. */
  remaining: Rupiah;
  /** `least(100, floor(saved × 100 / target))`. */
  pct: number;
  reached: boolean;
  /** Jumlah periode gajian sampai tanggal target; `null` = tanpa tanggal, lewat tanggal, atau tercapai. */
  periodsLeft: number | null;
  /** `ceil(remaining / periodsLeft)`; `null` = tidak ada laju (tanpa tanggal, lewat, tercapai). */
  perPeriod: Rupiah | null;
  /** Hanya baris selesai/arsip: dompetnya sudah dipakai tujuan aktif lain. */
  accountHasOtherActive: boolean;
}

/** Anggota lain di Bersama dua anggota (kalimat `Tujuan ini juga hilang dari Rencana {nama}`). */
export interface GoalData {
  goals: GoalVM[];
  /** Nama anggota lain; `null` = Pribadi atau Bersama solo. */
  partnerName: string | null;
}
