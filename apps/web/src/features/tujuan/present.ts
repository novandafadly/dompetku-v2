import type { GoalVM } from './types';

/**
 * Pemilihan kalimat kartu tujuan dari nilai SQL (bingkai S13-TJ3, tabel keadaan). Hanya
 * perbandingan dengan 0/null: tidak menjumlah, mengurangi, membagi, atau membulatkan (aturan 5).
 */

export type GoalState = 'reached' | 'overdue' | 'running';
export type SavedBand = 'none' | 'tiny' | 'normal';

/** `Tercapai` menang atas `Lewat tanggal target`; lewat tanggal = tanggal terisi tetapi periode habis. */
export function goalState(g: GoalVM): GoalState {
  if (g.reached) return 'reached';
  if (g.targetOn !== null && g.periodsLeft === null) return 'overdue';
  return 'running';
}

/** `none`: belum ada yang terkumpul (saldo 0 atau minus); `tiny`: ada uang tetapi persen 0. */
export function savedBand(g: GoalVM): SavedBand {
  if (g.saved === 0) return 'none';
  return g.pct === 0 ? 'tiny' : 'normal';
}

/** Dompet bersaldo minus (kalimat khusus: progres dihitung 0%). */
export function isNegative(g: GoalVM): boolean {
  return g.balance < 0;
}

/** `Pulihkan` tidak ditawarkan bila dompet terarsip; digantikan kalimat bila dompet sudah dipakai tujuan lain. */
export function restoreState(g: GoalVM): 'archived-wallet' | 'wallet-busy' | 'ok' {
  if (g.accountArchived) return 'archived-wallet';
  return g.accountHasOtherActive ? 'wallet-busy' : 'ok';
}
