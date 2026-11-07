import { dayOfMonth, shortDateLabel, weekdayShort, type IsoDate } from '@dompetku/domain';
import type { BillDueVM, BillListVM, RencanaData } from './types';

/**
 * Pengelompokan dan label Tagihan (S9-TG1). Fungsi murni tanpa `'use client'` (dipakai Server
 * Component dan pulau klien). Tanggal tidak pernah dihitung dari jam Node: hari ke jatuh tempo
 * (`daysUntil`) dan `overdue` datang dari SQL (`api.bills_due`); di sini hanya memformat.
 */

/** Satu baris daftar: kemunculan (`null` = tagihan aktif tanpa kemunculan terlihat) + tagihannya. */
export interface BillItem {
  occ: BillDueVM | null;
  bill: BillListVM;
}

export interface BillGroups {
  overdue: BillItem[];
  period: BillItem[];
  next: BillItem[];
  archived: BillListVM[];
}

/**
 * `Lewat jatuh tempo` (`overdue` SQL), `Periode ini` (sisa kemunculan sampai akhir periode,
 * termasuk Lunas/Dilewati), `Berikutnya` (sesudah periode ini). Di dalam kelompok urut `due_on`
 * (urutan SQL dipertahankan). Tagihan aktif tanpa kemunculan terlihat (mulai jauh di depan,
 * sudah berakhir) masuk `Berikutnya` supaya tetap bisa diubah atau diarsipkan.
 */
export function groupBills(
  data: Pick<RencanaData, 'bills' | 'due' | 'upcoming'>,
): BillGroups {
  const byId = new Map(data.bills.map((b) => [b.billId, b]));
  const overdue: BillItem[] = [];
  const period: BillItem[] = [];
  const next: BillItem[] = [];
  const seen = new Set<string>();
  const place = (list: BillItem[], occ: BillDueVM) => {
    const bill = byId.get(occ.billId);
    if (bill === undefined || bill.archived) return;
    seen.add(bill.billId);
    list.push({ occ, bill });
  };
  for (const occ of data.due) place(occ.overdue ? overdue : period, occ);
  for (const occ of data.upcoming) place(next, occ);
  for (const bill of data.bills) {
    if (!bill.archived && !seen.has(bill.billId)) next.push({ occ: null, bill });
  }
  return { overdue, period, next, archived: data.bills.filter((b) => b.archived) };
}

export type DueTone = 'muted' | 'danger' | 'accent';
export type DueIcon = 'clock' | 'warning' | 'check' | 'skip' | null;

/** Sub baris: `4 hari lagi`, `Hari ini`, `Besok`, `Lewat 3 hari`, `Lunas · 21 Okt`, `Dilewati`. */
export function dueSub(occ: BillDueVM): { text: string; tone: DueTone; icon: DueIcon } {
  if (occ.posted) {
    return { text: `Lunas · ${shortDateLabel(occ.paidOn ?? occ.dueOn)}`, tone: 'accent', icon: 'check' };
  }
  if (occ.skipped) return { text: 'Dilewati', tone: 'muted', icon: 'skip' };
  const n = occ.daysUntil;
  if (n < 0) return { text: `Lewat ${String(-n)} hari`, tone: 'danger', icon: 'warning' };
  if (n === 0) return { text: 'Hari ini', tone: 'muted', icon: 'clock' };
  if (n === 1) return { text: 'Besok', tone: 'muted', icon: 'clock' };
  if (n <= 30) return { text: `${String(n)} hari lagi`, tone: 'muted', icon: 'clock' };
  return { text: shortDateLabel(occ.dueOn), tone: 'muted', icon: 'clock' };
}

/** Ubin tanggal: hari singkat kapital dan tanggal dari `due_on` (tanpa jam perangkat). */
export function tileOf(dueOn: IsoDate): { weekday: string; day: number } {
  return { weekday: weekdayShort(dueOn), day: dayOfMonth(dueOn) };
}

/** Ada tombol `Bayar` / `Batalkan lewati` / tidak ada aksi, menurut keadaan kemunculan. */
export function rowAction(occ: BillDueVM | null): 'bayar' | 'batalkan' | null {
  if (occ === null || occ.posted) return null;
  return occ.skipped ? 'batalkan' : 'bayar';
}
