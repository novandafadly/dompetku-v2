import type { IsoDate } from '@dompetku/domain';
import type { ReactNode } from 'react';
import type { AccountVM, CategoryVM, Ruang } from '@/features/ledger/types';
import type { SplitContextVM } from '@/features/ledger/patungan-types';
import type { TripChoiceVM } from '@/features/ledger/trip-types';
import { RuangShell } from '../ruang-shell';
// Action entri didaftarkan untuk setiap page `[ruang]`: toast "Urungkan" hidup lebih lama daripada
// page yang membuatnya (Batalkan di Detail → toast di daftar Transaksi → `restoreEntryAction`).
// Next mencari Server Action di worker page yang sedang terbuka; action yang hanya terdaftar di
// page lain diteruskan (forward) tanpa menyegarkan UI, dan gagal untuk rute dinamis `[ruang]`.
// Impor dari graf server layout mendaftarkan semua export modul `'use server'` ini.
import '../_actions/entri';

/**
 * Shell mode nyata (Server Component): tanpa DemoProvider, sheet Catat nyata (`realCatatSource`)
 * dimuat malas; preload memuat chunk sheet nyata, bukan data demo. Opsi awal = dompet dan
 * kategori ruang halaman ini dari layout server; ruang lain diminta lewat action saat pindah
 * ruang di sheet (Review Focus 4). Klien tetap satu komponen `RuangShell` (anggaran JS).
 */
export function RuangShellReal({
  ruang,
  accounts,
  categories,
  split,
  trips,
  today,
  children,
}: {
  ruang: Ruang;
  accounts: AccountVM[];
  categories: CategoryVM[];
  /** Bersama dua anggota (S12-CT1); tidak ada di Pribadi atau Bersama solo. */
  split?: SplitContextVM | undefined;
  /** Trip aktif ruang ini untuk pemilih Catat (S15); tidak ada bila tidak ada yang bisa dipilih. */
  trips?: TripChoiceVM[] | undefined;
  today: IsoDate;
  children: ReactNode;
}) {
  return (
    <RuangShell
      ruang={ruang}
      real={{
        options: {
          accounts,
          categories,
          ...(split === undefined ? {} : { split }),
          ...(trips === undefined ? {} : { trips }),
        },
        today,
      }}
    >
      {children}
    </RuangShell>
  );
}
