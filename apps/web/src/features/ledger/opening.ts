import { addDays, daysInclusive, type IsoDate } from '@dompetku/domain';

/** Saldo awal hanya bisa diubah (nominalnya saja) ≤ 7 hari sejak dompet dibuka (BSD §9.1). */
export const OPENING_EDIT_DAYS = 7;

/** Saldo awal masih bisa diubah hari ini (aturan DB `opening_locked`). */
export function openingEditable(openedOn: IsoDate, today: IsoDate): boolean {
  return daysInclusive(openedOn, today) - 1 <= OPENING_EDIT_DAYS;
}

/** Hari pertama saldo awal terkunci (untuk keterangan `terkunci sejak {tanggal}`). */
export function openingLockedOn(openedOn: IsoDate): IsoDate {
  return addDays(openedOn, OPENING_EDIT_DAYS + 1);
}
