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
  const rest = query.startsWith('?') ? `&${query.slice(1)}` : '';
  return `/${ruang}/rencana?bagian=${bagian}${rest}` as Route;
}
