import { describe, expect, it } from 'vitest';
import { segmentItem as clientItem, segmentTrack as clientTrack } from './segmented-control';
import { segmentItem, segmentTrack } from './segment-styles';

/**
 * `segment-styles.ts` adalah salinan sengaja dari `segmented-control.tsx` (modul klien) supaya
 * Server Component bisa memakainya tanpa menambah byte rute prototipe. Tes ini menjaga keduanya
 * tidak menyimpang.
 */
describe('segment-styles = segmented-control', () => {
  it('jalur dan butir (terpilih dan tidak) identik', () => {
    expect(segmentTrack).toBe(clientTrack);
    expect(segmentItem(true)).toBe(clientItem(true));
    expect(segmentItem(false)).toBe(clientItem(false));
  });
});
