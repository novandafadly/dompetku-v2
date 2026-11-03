import { createSeed, type DemoState, type Entry } from '@dompetku/demo-data';
import { describe, expect, it } from 'vitest';
import { trashItems } from './demo-items';

const TODAY = '2026-10-17';

function voided(state: DemoState, id: string, voidedAt: string): DemoState {
  return {
    ...state,
    entries: state.entries.map((e): Entry => (e.id === id ? { ...e, voidedAt } : e)),
  };
}

const seed = createSeed({ today: TODAY, variant: 'full' });
const mine = seed.entries.filter((e) => e.ruang === 'pribadi' && e.kind === 'expense');
const theirs = seed.entries.find((e) => e.ruang === 'bersama' && e.kind === 'expense');

describe('trashItems (Sampah prototipe)', () => {
  it('seed tanpa entri batal = kosong', () => {
    expect(trashItems(seed, 'pribadi', TODAY)).toEqual([]);
  });

  it('hanya entri batal ruang ini, ≤ 90 hari terhadap today, terbaru dulu', () => {
    const [a, b, c] = mine;
    if (!a || !b || !c || !theirs) throw new Error('seed kurang');
    let s = voided(seed, a.id, '2026-10-17T09:00:00+07:00'); // hari ini
    s = voided(s, b.id, '2026-07-19T09:00:00+07:00'); // tepat 90 hari lalu: masih ikut
    s = voided(s, c.id, '2026-07-18T23:59:00+07:00'); // 91 hari: lewat
    s = voided(s, theirs.id, '2026-10-16T09:00:00+07:00'); // ruang lain
    const items = trashItems(s, 'pribadi', TODAY);
    expect(items.map((i) => i.entry.id)).toEqual([a.id, b.id]);
    expect(trashItems(s, 'bersama', TODAY).map((i) => i.entry.id)).toEqual([theirs.id]);
    expect(items[0]?.entry.voidedAt).toBe('2026-10-17T09:00:00+07:00');
    expect(items[0]?.purgeAfter).toBe('2027-01-15T09:00:00+07:00');
    expect(items[1]?.purgeAfter).toBe('2026-10-17T09:00:00+07:00');
  });
});
