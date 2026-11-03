// Bagian selectors demo; satu berkas per kelompok pemakai supaya rute hanya memuat yang dipakai
// (paket bebas efek samping, ADR 0002).
import type { Rupiah } from '@dompetku/domain';
import type { DemoState, Ruang } from '../types';
import { isLive } from './live';

export interface MonthSummary {
  pemasukan: Rupiah;
  pengeluaran: Rupiah;
  /** pemasukan − pengeluaran; bisa negatif. */
  selisih: Rupiah;
  /** Σ pemasukan + pengeluaran di dompet pocket kantor (tidak masuk tiga angka di atas). */
  kantor: Rupiah;
  /** Σ transfer + Σ kaki space_transfer ruang ini (keluar di asal, masuk di tujuan). */
  transfer: Rupiah;
}

/** Ringkasan bulan 'YYYY-MM'. Saldo awal dan entri batal tidak dihitung. */
export function monthSummary(state: DemoState, ruang: Ruang, month: string): MonthSummary {
  const kantorIds = new Set(
    state.accounts.filter((a) => a.ruang === ruang && a.pocket === 'kantor').map((a) => a.id),
  );
  let pemasukan = 0;
  let pengeluaran = 0;
  let kantor = 0;
  let transfer = 0;
  for (const e of state.entries) {
    if (!isLive(e) || e.ruang !== ruang || !e.occurredOn.startsWith(month)) continue;
    if (e.kind === 'income' || e.kind === 'expense') {
      if (kantorIds.has(e.accountId)) kantor += e.amount;
      else if (e.kind === 'income') pemasukan += e.amount;
      else pengeluaran += e.amount;
    } else if (e.kind === 'transfer' || e.kind === 'space_transfer') {
      transfer += e.amount;
    }
  }
  return { pemasukan, pengeluaran, selisih: pemasukan - pengeluaran, kantor, transfer };
}
