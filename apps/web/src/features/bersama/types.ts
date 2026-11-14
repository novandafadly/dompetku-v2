import type { Route } from 'next';
import type { IsoDate, Rupiah } from '@dompetku/domain';
import type { EntryVM } from '@/features/ledger/types';

/**
 * View-model feed Aktivitas dan Kontribusi Bersama (S8, bingkai S8-A1/A2/A3/K1). Dirangkai di
 * server (`server/ledger/bersama.ts`) dan diserialisasi ke payload RSC, jadi batas privasi K1
 * berlaku untuk setiap field: tanpa nama/id dompet, `link_id`, id entri ruang lain, deskripsi
 * kaki antar ruang, atau baris Pribadi.
 */

export type ActivityOp = 'create' | 'update' | 'void' | 'restore';

/**
 * Satu baris `api.shared_activity` sesudah validasi Zod (nama kolom camelCase). `at` = waktu
 * peristiwa sebagai ISO WIB `YYYY-MM-DDTHH:MM:SS+07:00` (bentuk `createdAt` EntryVM).
 */
export interface SharedActivityRow {
  entryId: string;
  version: number;
  op: ActivityOp;
  kind: EntryVM['kind'];
  direction: 'in' | 'out' | null;
  actorId: string;
  at: string;
  occurredOn: IsoDate;
  amount: Rupiah;
  beforeAmount: Rupiah | null;
  categoryId: string | null;
  beforeCategoryId: string | null;
  description: string | null;
  sharedNote: string | null;
  moved: boolean;
  /**
   * Pengeluaran tagihan patungan (S12): dibayar dari dompet Pribadi pembayar. Diisi server
   * (`systemWalletEntriesTx`), bukan kolom DB; hanya jenis `expense`.
   */
  viaPersonal?: true;
}

/** Anggota dari `app.space_roster` + `space_members.role` (warna avatar menurut peran). */
export interface MemberVM {
  id: string;
  name: string;
  initial: string;
  role: 'owner' | 'member';
}

export interface ActivityItemVM {
  /** `{entryId}:{version}`, unik per peristiwa. */
  key: string;
  entryId: string;
  /**
   * Pelaku. Di luar roster (anggota terhapus; tidak terjadi hari ini): nama `Anggota`, inisial
   * `?`, `role: null` (avatar netral).
   */
  actor: Omit<MemberVM, 'role'> & { role: MemberVM['role'] | null };
  /** Waktu peristiwa, ISO WIB (`dayLabel(at.slice(0, 10))`, `timeLabelWIB(at)`). */
  at: string;
  /** Kalimat tanpa nama pelaku (`mencatat pengeluaran Makan`); nama dirender terpisah. */
  text: string;
  /** Baris perubahan tampil (`Rp 50.000 → Rp 75.000`, `Makan → Belanja`), `aria-hidden`. */
  change: string[];
  /** Pengganti baris perubahan untuk pembaca layar (`dari … menjadi …`). */
  srText?: string;
  /** Akhiran baris waktu untuk pencatatan mundur (`tanggal 26 Okt`), hanya create/restore. */
  backdate: string | null;
  /** Nominal kanan; `null` bila baris perubahan sudah memuat nominal (tidak ada angka ganda). */
  amount: Rupiah | null;
  /** Nominal versi sebelumnya, hanya bila nominal berubah (`update`). */
  beforeAmount: Rupiah | null;
  /** Void entri yang dipindah ke ruang lain (R26). */
  moved: boolean;
  /** Detail entri Bersama; `null` = baris tanpa target (cadangan). */
  href: Route | null;
}

export interface ContributionRowVM {
  member: MemberVM;
  setoran: Rupiah;
  diambil: Rupiah;
}

export interface ContributionVM {
  /** Bulan kalender WIB berjalan (K3); `label` = nama bulan (`November`). */
  period: { from: IsoDate; to: IsoDate; label: string };
  /** Urutan tetap: pemilik lalu anggota (sama untuk kedua pembaca). */
  rows: ContributionRowVM[];
  /** Semua setoran dan pengambilan nol: kartu menampilkan `EmptyLine` (S8-K1). */
  allZero: boolean;
}
