import type { IsoDate, Rupiah } from '@dompetku/domain';
import type { EntryVM } from './types';

/**
 * View-model Trip (S15, bingkai `docs/design/s15-bingkai.md`). Dirangkai di server
 * (`server/ledger/trip.ts`) dari `api.list_trips/trip_overview/trip_breakdown/trip_candidates` (DB
 * `0147`); semua angka (total, banyak pengeluaran, rata-rata per hari, sisa anggaran, persen, rincian)
 * datang dari SQL. UI hanya memilih kalimat dari nilai itu (perbandingan dengan 0/null) dan
 * memformat; tidak menjumlah, membagi, atau mengurangkan uang (I6).
 */

/** Fase dari tanggal WIB server: `upcoming` = Akan datang, `ongoing` = Berlangsung, `ended` = Selesai. */
export type TripPhase = 'upcoming' | 'ongoing' | 'ended';

/** Satu baris daftar Trip (`api.list_trips`; urutan SQL: aktif dulu, mulai terbaru, lalu arsip). */
export interface TripVM {
  id: string;
  name: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  /** `null` = tanpa anggaran trip (hanya pembanding, bukan anggaran bulanan). */
  budget: Rupiah | null;
  archived: boolean;
  phase: TripPhase;
  /** Panjang trip: akhir − mulai + 1. */
  dayCount: number;
  /** Total pengeluaran trip (kelas `expense` Laporan); 0 bila belum ada. */
  spent: Rupiah;
  entryCount: number;
  /** `budget − spent` (negatif = lebih); `null` tanpa anggaran. */
  budgetLeft: Rupiah | null;
}

/** `api.trip_overview` untuk satu trip di ruang ini. */
export interface TripOverviewVM {
  id: string;
  name: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  budget: Rupiah | null;
  archived: boolean;
  phase: TripPhase;
  dayCount: number;
  /** Hari berjalan: 0 bila belum mulai, sampai `endsOn` bila sudah lewat. */
  elapsedDays: number;
  spent: Rupiah;
  entryCount: number;
  /** `spent ÷ elapsedDays` dibulatkan ke bawah; `null` bila belum ada hari berjalan atau total 0. */
  perDay: Rupiah | null;
  budgetLeft: Rupiah | null;
  /** `floor(spent × 100 ÷ budget)`, tidak dibatasi 100; `null` tanpa anggaran. */
  pct: number | null;
  firstEntryOn: IsoDate | null;
  lastEntryOn: IsoDate | null;
}

/** Satu baris rincian: kunci stabil (`key`), label tampilan, jumlah, banyak pengeluaran. */
export interface TripBreakdownRowVM {
  key: string;
  /** `null` = pencatat yang sudah bukan anggota ruang (hanya `member`). */
  label: string | null;
  amount: Rupiah;
  entryCount: number;
  /** Hanya `member`: baris ini milik pengguna yang melihat (`Kamu`). */
  isMe?: true;
}

export interface TripBreakdownVM {
  /** Kategori induk (`key` = id kategori atau `none` = Tanpa kategori); jumlah turun. */
  category: TripBreakdownRowVM[];
  /** Hanya hari berpengeluaran (`key` = tanggal ISO); jumlah turun. */
  day: TripBreakdownRowVM[];
  /** Pencatat (`key` = id pengguna); UI hanya menampilkannya bila `memberCount` ≥ 2. */
  member: TripBreakdownRowVM[];
}

/** Kandidat `Masukkan {n} pengeluaran`: pengeluaran biasa tanpa trip dalam rentang tanggal trip. */
export interface TripCandidateVM {
  entryId: string;
  occurredOn: IsoDate;
  description: string | null;
  categoryName: string | null;
  accountName: string;
  /** Positif. */
  amount: Rupiah;
}

/** Batas satu panggilan `setEntriesTrip` (DB: 1..100 entri). */
export const TRIP_BATCH_MAX = 100;
/** Batas baris daftar pengeluaran di Detail trip (sisanya hanya masuk rincian dan ekspor). */
export const TRIP_ENTRIES_MAX = 200;

/** Isi Detail trip (satu transaksi baca). `null` dari loader = tidak ada di ruang ini (404 seragam). */
export interface TripDetailData {
  trip: TripOverviewVM;
  breakdown: TripBreakdownVM;
  /** Maks `TRIP_BATCH_MAX` baris; kosong untuk trip terarsip. */
  candidates: TripCandidateVM[];
  /** Ada lebih dari `TRIP_BATCH_MAX` kandidat. */
  candidatesMore: boolean;
  /** Pengeluaran hidup trip, terbaru dulu, maks `TRIP_ENTRIES_MAX`. */
  entries: EntryVM[];
  entriesTruncated: boolean;
  /** Banyak anggota ruang (rincian `Dicatat oleh` hanya bila ≥ 2). */
  memberCount: number;
}

/** Pilihan trip di Catat/Ubah: trip aktif ruang ini saja (data ruang lain tidak pernah ikut). */
export interface TripChoiceVM {
  id: string;
  name: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
}

/** Jendela pemilih Catat: trip aktif yang berakhir paling lama sekian hari lalu atau akan datang. */
export const TRIP_CHOICE_WINDOW_DAYS = 30;
/** Maksimum trip di pemilih Catat. */
export const TRIP_CHOICE_MAX = 20;
