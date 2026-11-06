import type { Rupiah } from '@dompetku/domain';
import type { AmanReason, AmanStatus } from '@/features/ledger/types';

/**
 * Keadaan kartu "Aman dipakai" (K7, bingkai S9-BR1) dari angka SQL (`api.safe_to_spend`,
 * `api.spend_pace`); fungsi murni, tanpa aritmetika uang:
 * - `lewat`: total < 0;
 * - `hati_hati`: ada tagihan lewat jatuh tempo (sebab `overdue`, menang), atau per hari lebih
 *   kecil dari rata-rata pengeluaran harian 30 hari (sebab `pace`; sama persis = aman);
 * - `aman`: sisanya.
 * Server-safe (tanpa `'use client'`), dipakai loader Beranda.
 */
export function amanStatus(
  safe: { aman: Rupiah; perDay: Rupiah },
  pace: { avgDaily: Rupiah; overdueBills: number },
): { status: AmanStatus; reason: AmanReason } {
  if (safe.aman < 0) return { status: 'lewat', reason: null };
  if (pace.overdueBills > 0) {
    return { status: 'hati_hati', reason: { kind: 'overdue', count: pace.overdueBills } };
  }
  if (safe.perDay < pace.avgDaily) {
    return { status: 'hati_hati', reason: { kind: 'pace', avgDaily: pace.avgDaily } };
  }
  return { status: 'aman', reason: null };
}
