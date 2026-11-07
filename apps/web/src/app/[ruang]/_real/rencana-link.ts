import type { Route } from 'next';
import type { Ruang } from '@/features/ledger/types';

/**
 * Tautan kartu Beranda ke bagian Rencana (S9-BR2). `query` bawaan ('' atau '?theme=x') digabung
 * dengan `bagian`. Modul sendiri (bukan `shell/hrefs`) supaya bundel prototipe tidak tersentuh.
 */
export function rencanaBagianHref(
  ruang: Ruang,
  bagian: 'anggaran' | 'tagihan',
  query: string,
): Route {
  // Anggaran = bagian bawaan Rencana: URL kanonik tanpa `?bagian=`.
  const parts = [
    ...(bagian === 'tagihan' ? ['bagian=tagihan'] : []),
    ...(query.startsWith('?') ? [query.slice(1)] : []),
  ];
  return `/${ruang}/rencana${parts.length === 0 ? '' : `?${parts.join('&')}`}` as Route;
}
