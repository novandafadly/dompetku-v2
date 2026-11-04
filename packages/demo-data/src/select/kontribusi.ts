// Kontribusi Bersama per anggota (K2, S8): Setor = kaki masuk Bersama, Diambil = kaki keluar
// Bersama, dihitung per pencatat atas entri `space_transfer` Bersama yang hidup dan tanggalnya
// dalam periode. Pemasukan biasa tidak dihitung (K4), tanpa angka bersih. Dimuat lewat berkas
// langsung (bukan barrel `selectors.ts`) supaya hanya chunk muat malas kartu demo yang membawanya.
import type { Rupiah } from '@dompetku/domain';
import type { DemoState } from '../types';
import { isLive } from './live';

export interface MemberContribution {
  memberId: string;
  setoran: Rupiah;
  diambil: Rupiah;
}

/** Satu baris per anggota (urutan `state.members`), periode inklusif `[from, to]` atas `occurredOn`. */
export function memberContributions(
  state: DemoState,
  from: string,
  to: string,
): MemberContribution[] {
  const byMember = new Map<string, MemberContribution>(
    state.members.map((m) => [m.id, { memberId: m.id, setoran: 0, diambil: 0 }]),
  );
  for (const e of state.entries) {
    if (e.ruang !== 'bersama' || e.kind !== 'space_transfer' || !isLive(e)) continue;
    if (e.occurredOn < from || e.occurredOn > to) continue;
    const row = byMember.get(e.createdBy);
    if (!row) continue;
    if (e.direction === 'in') row.setoran += e.amount;
    else if (e.direction === 'out') row.diambil += e.amount;
  }
  return [...byMember.values()];
}
