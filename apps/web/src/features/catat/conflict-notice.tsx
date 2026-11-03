'use client';

import { dayLabel, formatRupiah, type IsoDate, type Rupiah } from '@dompetku/domain';
import type { ReactNode } from 'react';
import { WarningIcon } from '@/components/ui/icons/warning';
import type { EntryVM } from '@/features/ledger/types';

const MINUTE = 60_000;

/**
 * "baru saja", "2 menit lalu", "3 jam lalu", "4 hari lalu" dari stempel waktu ISO (server, WIB).
 * Jam perangkat di belakang server (selisih negatif) tetap "baru saja".
 */
export function relativeTime(at: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(at)) / MINUTE);
  if (!(minutes >= 1)) return 'baru saja';
  if (minutes < 60) return `${String(minutes)} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} jam lalu`;
  return `${String(Math.floor(hours / 24))} hari lalu`;
}

/**
 * Salinan tetap S6-D2: `{Nama} mengubah transaksi ini {waktu relatif} ({Rp lama} → {Rp baru}).
 * Muat versi terbaru untuk melanjutkan.` Nominal sama: bagian dalam kurung dihilangkan.
 * `before` = nominal versi yang dibuka pengguna; `after` = nominal versi terbaru.
 */
export function conflictText({
  by,
  at,
  before,
  after,
  now,
}: {
  by: string;
  at: string;
  before: Rupiah;
  after: Rupiah;
  now: Date;
}): string {
  const change = before === after ? '' : ` (${formatRupiah(before)} → ${formatRupiah(after)})`;
  return `${by} mengubah transaksi ini ${relativeTime(at, now)}${change}. Muat versi terbaru untuk melanjutkan.`;
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-t border-hairline first:border-t-0">
      <dt className="text-meta font-medium text-text-muted">{term}</dt>
      <dd className="min-w-0 text-right text-label font-bold break-words text-text">{children}</dd>
    </div>
  );
}

/**
 * S6-D2 di dalam sheet Ubah, di atas kaki: kotak `warning-tint` dengan pesan (`role="alert"`) dan
 * daftar ringkas nilai terbaru (`<dl>`). Tombol `Muat ulang` dan `Timpa dengan perubahan saya` ada
 * di kaki sheet. Hanya pemasukan, pengeluaran, dan saldo awal yang bisa diubah. Label kategori
 * ditulis di sini, bukan lewat `features/ledger/present`, agar modul itu tetap disatukan ke chunk
 * page Transaksi prototipe (importir kedua menambah JS muat awalnya, ADR 0002).
 */
export function ConflictNotice({
  id,
  latest,
  by,
  at,
  before,
  today,
  now,
}: {
  id: string;
  latest: EntryVM;
  /** Nama pengubah terakhir, atau `Kamu` bila pengguna sendiri (tab lain). */
  by: string;
  /** Stempel waktu ubah terakhir (riwayat). */
  at: string;
  /** Nominal versi yang dibuka pengguna. */
  before: Rupiah;
  today: IsoDate;
  now: Date;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-warning-tint p-3">
      <p id={id} role="alert" className="flex items-start gap-2 text-label font-semibold text-text">
        <WarningIcon size={18} weight="fill" className="mt-px shrink-0 text-warning" />
        <span className="text-pretty">
          {conflictText({ by, at, before, after: latest.amount, now })}
        </span>
      </p>
      <div role="group" aria-label="Nilai terbaru">
        <dl className="flex flex-col">
          <Row term="Nominal">
            <span className="num whitespace-nowrap">{formatRupiah(latest.amount)}</span>
          </Row>
          <Row term="Kategori">
            {latest.kind === 'opening_balance'
              ? 'Saldo awal'
              : (latest.categoryName ?? 'Tanpa kategori')}
          </Row>
          <Row term="Dompet">{latest.accountName}</Row>
          <Row term="Tanggal">{dayLabel(latest.occurredOn, today)}</Row>
        </dl>
      </div>
    </div>
  );
}
