import type { IsoDate } from '@dompetku/domain';
import type { ReactNode } from 'react';
import type { AccountVM, CategoryVM, Ruang } from '@/features/ledger/types';
import { RuangShell } from '../ruang-shell';

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
