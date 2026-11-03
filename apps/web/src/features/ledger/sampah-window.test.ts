import { describe, expect, it } from 'vitest';
import { TRASH_COPY } from '@/features/sampah/trash-states';
import { VOIDED_COPY } from '@/features/transaksi/voided-banner';
import { SAMPAH_HARI } from './sampah-window';

describe('SAMPAH_HARI (satu sumber salinan "90 hari")', () => {
  it('nilai dan salinan tetap tidak berubah', () => {
    expect(SAMPAH_HARI).toBe(90);
    expect(VOIDED_COPY.closed).toBe('Lewat 90 hari, transaksi ini tidak bisa dipulihkan lagi.');
    expect(TRASH_COPY.empty).toBe(
      'Sampah kosong. Transaksi yang dibatalkan bisa dipulihkan di sini selama 90 hari.',
    );
  });
});
