import { describe, expect, it, vi } from 'vitest';
import { voidFailedText } from './detail-client';

vi.mock('../_actions/entri', () => ({ voidEntryAction: vi.fn(), restoreEntryAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));

describe('voidFailedText', () => {
  it('asset_negative (batal Isi yang sebagiannya sudah ditarik): salinan aset, bukan galat server (S14)', () => {
    expect(voidFailedText('asset_negative', 'Emas Antam')).toBe(
      'Belum bisa dibatalkan. Nilai Emas Antam tidak cukup. Aset tidak bisa minus.',
    );
    expect(voidFailedText('asset_negative')).toBe(
      'Belum bisa dibatalkan. Nilai aset ini tidak cukup. Aset tidak bisa minus.',
    );
  });

  it('kode lain tetap: konflik dan galat umum', () => {
    expect(voidFailedText('conflict')).toMatch(/baru saja diubah/);
    expect(voidFailedText('unknown')).toMatch(/kendala di server/);
  });
});
