'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { IsoDate } from '@dompetku/domain';
import { CatatSheet } from '@/features/catat/catat-sheet';
import type { CatatOptions } from '@/features/catat/source';
import type { Ruang } from '@/features/ledger/types';
import { buildAddWalletHref, RUANG_LABEL } from '@/features/shell/hrefs';
import { useNav } from '@/features/shell/nav-provider';
import type { LazySheetProps } from '../catat-slot';
import { realCatatSource } from './catat-source-real';

/**
 * Sheet Catat mode nyata (dimuat malas bersama sheet; tidak ikut JS muat awal rute).
 *
 * Umur sumber: satu `realCatatSource` per sheet dibuka. Opsi ruang lain, saldo, dan chip yang
 * di-cache sumber hidup selama satu sesi sheet saja; pembukaan berikutnya memakai props layout
 * terbaru (sesudah `refresh()` dari action simpan/urungkan), jadi saldo S6-C3 dan chip tidak basi.
 * `track` di sheet menangkap sumber saat sesi dibuka; sumber yang sama dipakai sampai sesi itu
 * selesai, jadi event satu alur selalu lewat sumber yang sama.
 */

/** Nilai yang lahir saat `open` menjadi `true` dan bertahan sampai pembukaan berikutnya. */
export function useSessionValue<T>(open: boolean, create: () => T): T | null {
  const [s, setS] = useState<{ open: boolean; value: T | null }>(() => ({
    open,
    value: open ? create() : null,
  }));
  if (open !== s.open) {
    const next = { open, value: open ? create() : s.value };
    setS(next);
    return next.value;
  }
  return s.value;
}

export function RealCatatSheet({
  home,
  options,
  ...props
}: LazySheetProps & {
  /** Ruang halaman; opsinya dimuat server untuk layout (data ruang ini saja). */
  home: Ruang;
  options: CatatOptions;
  today: IsoDate;
}) {
  const router = useRouter();
  const nav = useNav();
  const source = useSessionValue(props.open, () =>
    realCatatSource({ ruang: home, options, ruangLabel: RUANG_LABEL }),
  );
  if (source === null) return null;
  return (
    <CatatSheet
      {...props}
      source={source}
      // Varian keypad dalam aplikasi hanya eksperimen prototipe (`?keypad=app`).
      keypad="os"
      // S6-C6: Catat menutup, lalu Dompet ruang itu terbuka dengan sheet Tambah dompet (`?tambah=1`).
      onAddAccount={(r) => {
        router.push(buildAddWalletHref(r, nav.query));
      }}
    />
  );
}
