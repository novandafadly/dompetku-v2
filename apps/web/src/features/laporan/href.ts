import type { Route } from 'next';
import type { Ruang } from '@/features/ledger/types';
import type { LaporanBasis } from './types';

/**
 * Alamat Laporan `/{ruang}/laporan?periode=YYYY-MM&basis=gajian|kalender`. `query` = parameter
 * yang dibawa antar halaman (hanya `theme` di mode nyata); `periode` kosong = periode berjalan.
 */
export function laporanHref(
  ruang: Ruang,
  query: string,
  opts: { periode?: string | null | undefined; basis?: LaporanBasis | undefined } = {},
): Route {
  const params = new URLSearchParams(query);
  params.delete('periode');
  params.delete('basis');
  if (opts.periode) params.set('periode', opts.periode);
  if (opts.basis) params.set('basis', opts.basis);
  const q = params.toString();
  return `/${ruang}/laporan${q === '' ? '' : `?${q}`}` as Route;
}

/** Alamat unduhan CSV periode yang sedang dilihat (`/{ruang}/laporan/ekspor`, S10-EX1). */
export function eksporHref(ruang: Ruang, opts: { periode: string; basis: LaporanBasis }): Route {
  const params = new URLSearchParams({ periode: opts.periode, basis: opts.basis });
  return `/${ruang}/laporan/ekspor?${params.toString()}` as Route;
}

/** Nama berkas ekspor CSV: ruang dan periode saja (tanpa nama orang). */
export function eksporFilename(ruang: Ruang, periode: string, basis: LaporanBasis): string {
  return `dompetku-${ruang}-${periode}${basis === 'kalender' ? '-kalender' : ''}.csv`;
}

/** Alamat unduhan PDF periode yang sedang dilihat (`/{ruang}/laporan/ekspor-pdf`, S16-PD1). */
export function eksporPdfHref(ruang: Ruang, opts: { periode: string; basis: LaporanBasis }): Route {
  const params = new URLSearchParams({ periode: opts.periode, basis: opts.basis });
  return `/${ruang}/laporan/ekspor-pdf?${params.toString()}` as Route;
}

/** Nama berkas ekspor PDF: ruang dan periode saja (tanpa nama orang). */
export function eksporPdfFilename(ruang: Ruang, periode: string, basis: LaporanBasis): string {
  return `dompetku-${ruang}-${periode}${basis === 'kalender' ? '-kalender' : ''}.pdf`;
}
