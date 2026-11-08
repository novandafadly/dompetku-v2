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
