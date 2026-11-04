'use client';

import { formatRupiah, shortDateLabel, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { ReactNode, RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { CircleNotchIcon } from '@/components/ui/icons/circle-notch';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { WarningIcon } from '@/components/ui/icons/warning';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';

/** Salinan final S6-C1…C6 (docs/design/s6-bingkai.md); jangan diubah tanpa bingkai. */
export const CATAT_COPY = {
  menyimpan: 'Menyimpan…',
  galat: 'Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.',
  cobaLagi: 'Coba lagi',
  tetapSimpan: 'Tetap simpan',
  idem: 'Catatan ini sudah pernah terkirim dengan isi berbeda. Periksa riwayat Transaksi, lalu simpan sebagai catatan baru bila memang belum ada.',
  simpanBaru: 'Simpan sebagai catatan baru',
  tambahDompet: 'Tambah dompet',
} as const;

/** Salinan galat simpan per jenis (s6-bingkai.md, "Tambahan salinan (keputusan controller)"). */
export function galatText(
  kind: 'network' | 'server' | 'not_found' | 'cross_space_not_allowed' | 'cross_space_kantor',
): string {
  if (kind === 'cross_space_not_allowed') {
    return 'Dompet ini tidak bisa dipakai untuk transfer antar ruang. Pilih dompet tujuan lain.';
  }
  if (kind === 'cross_space_kantor') {
    return 'Dompet Kantor tidak bisa ikut transfer antar ruang. Pilih dompet lain.';
  }
  if (kind === 'network') return CATAT_COPY.galat;
  if (kind === 'not_found') return 'Data ini sudah tidak ada. Tutup lalu buka Catat lagi.';
  return 'Belum tersimpan. Ada kendala di server. Coba lagi tidak akan mencatat dua kali.';
}

/** Galat kolom kategori (`category_archived`, gaya S6-C5). */
export function categoryArchivedText(kategori: string): string {
  return `${kategori} sudah diarsipkan. Pilih kategori lain.`;
}

/** S6-C3. `after` negatif, ditulis dengan tanda minus (`−Rp`). */
export function saldoKurangText(dompet: string, balance: Rupiah, after: Rupiah): string {
  return `Saldo ${dompet} tinggal ${formatRupiah(balance)}. Kalau disimpan, saldonya jadi ${formatRupiah(after)}.`;
}

/** S6-C5 `before_opening`. */
export function beforeOpeningText(dompet: string, openedOn: IsoDate): string {
  const tanggal = shortDateLabel(openedOn);
  return `${dompet} baru dicatat sejak ${tanggal}. Pilih tanggal ${tanggal} atau sesudahnya.`;
}

/** S6-C5 `account_archived`. */
export function accountArchivedText(dompet: string): string {
  return `${dompet} sudah diarsipkan. Pilih dompet lain.`;
}

/** S6-C6. */
export function noAccountText(ruang: string): string {
  return `Belum ada dompet di ${ruang}. Tambah dompet dulu untuk mencatat.`;
}

/**
 * Kotak pesan sebaris di atas baris kaki (S6-C2 galat, S6-C4 kunci bentrok): `role="alert"`.
 * Mode keyboard: teks utuh (tidak dipotong ellipsis), boleh dua baris; kotak dirapatkan agar tinggi
 * sheet tetap ≤ 356.
 */
export function CatatAlert({
  id,
  tone,
  compact = false,
  children,
}: {
  id: string;
  tone: 'danger' | 'warning';
  compact?: boolean;
  children: ReactNode;
}) {
  const Icon = tone === 'danger' ? WarningCircleIcon : WarningIcon;
  const toneClass =
    tone === 'danger' ? 'bg-danger-tint text-danger' : 'bg-warning-tint text-warning';
  if (compact) {
    // Ikon sebaris di awal teks (bukan kolom sendiri) agar teks utuh muat dua baris di 360 px.
    return (
      <p
        id={id}
        role="alert"
        className={`-mt-1.5 -mb-0.5 rounded-lg px-3 py-0.5 text-caption/tight font-semibold ${toneClass}`}
      >
        <Icon size={16} weight="fill" className="mr-1.5 -my-0.5 inline-block align-text-bottom" />
        {children}
      </p>
    );
  }
  return (
    <p
      id={id}
      role="alert"
      className={`flex items-start gap-2 rounded-lg p-3 text-label font-semibold ${toneClass}`}
    >
      <Icon size={18} weight="fill" className="mt-px shrink-0" />
      <span className="text-pretty">{children}</span>
    </p>
  );
}

/** S6-C3: satu baris ikon + teks tanpa kotak (tinggi mode keyboard tetap muat), `role="status"`. */
export function SaldoKurangRow({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p
      id={id}
      role="status"
      className="flex items-start gap-1.5 text-meta font-semibold text-warning"
    >
      <WarningIcon size={16} weight="fill" className="mt-px shrink-0" />
      <span className="min-w-0 text-pretty">{children}</span>
    </p>
  );
}

/** S6-C5: teks galat di bawah kolom; tanpa `role="alert"` (fokus yang pindah sudah mengumumkan). */
export function FieldErrorText({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-meta font-semibold text-danger">
      <WarningCircleIcon size={16} weight="fill" className="mt-px shrink-0" />
      <span className="min-w-0 text-pretty">{children}</span>
    </p>
  );
}

/** S6-C1: isi tombol kaki selama menyimpan; ikon diam bila gerak dikurangi. */
export function SavingLabel() {
  return (
    <>
      <CircleNotchIcon size={18} weight="bold" className="shrink-0 motion-safe:animate-spin" />
      {CATAT_COPY.menyimpan}
    </>
  );
}

/** S6-C6: ruang tanpa dompet. Teks menjadi deskripsi dialog (`id`). */
export function NoAccountState({
  id,
  ruang,
  onAdd,
  buttonRef,
}: {
  id: string;
  ruang: string;
  onAdd: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="flex flex-col items-start gap-3 pb-1">
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-toast bg-accent-tint text-accent-text"
      >
        <WalletIcon size={24} />
      </span>
      <p id={id} className="text-body font-semibold text-text text-pretty">
        {noAccountText(ruang)}
      </p>
      <Button ref={buttonRef} className="w-full" onClick={onAdd}>
        {CATAT_COPY.tambahDompet}
      </Button>
    </div>
  );
}
