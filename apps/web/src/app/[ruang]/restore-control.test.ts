import { describe, expect, it } from 'vitest';
import { restoreFailedText } from './restore-control';

describe('restoreFailedText', () => {
  it('entry_moved memakai salinan tabel galat S7', () => {
    expect(restoreFailedText('entry_moved', 'Bersama')).toBe(
      'Transaksi ini sudah dipindahkan ke Bersama dan tidak bisa dipulihkan dari sini.',
    );
  });
});
