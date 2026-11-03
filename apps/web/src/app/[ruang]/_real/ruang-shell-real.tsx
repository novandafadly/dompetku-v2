import type { IsoDate } from '@dompetku/domain';
import type { ReactNode } from 'react';
import type { AccountVM, CategoryVM, Ruang } from '@/features/ledger/types';
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
  today,
  children,
}: {
  ruang: Ruang;
  accounts: AccountVM[];
  categories: CategoryVM[];
  today: IsoDate;
  children: ReactNode;
}) {
  return (
    <RuangShell ruang={ruang} real={{ options: { accounts, categories }, today }}>
      {children}
    </RuangShell>
  );
}
