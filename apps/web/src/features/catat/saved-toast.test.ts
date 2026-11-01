import { describe, expect, it, vi } from 'vitest';
import { undoOrNotify, UNDO_FAILED } from './saved-toast';

const saved = { entryId: 'e1', version: 1, ruang: 'pribadi' as const };

describe('undoOrNotify', () => {
  it('urungkan gagal → toast pemberitahuan', async () => {
    const notify = vi.fn();
    await undoOrNotify(() => Promise.resolve(false), saved, notify);
    expect(notify).toHaveBeenCalledWith({ message: UNDO_FAILED, tone: 'info' });
    expect(UNDO_FAILED).toBe('Belum bisa diurungkan. Buka transaksi itu untuk membatalkannya.');
  });
  it('urungkan melempar → toast pemberitahuan', async () => {
    const notify = vi.fn();
    await undoOrNotify(() => Promise.reject(new Error('x')), saved, notify);
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it('urungkan berhasil → tanpa toast', async () => {
    const notify = vi.fn();
    const undo = vi.fn(() => Promise.resolve(true));
    await undoOrNotify(undo, saved, notify);
    expect(undo).toHaveBeenCalledWith(saved);
    expect(notify).not.toHaveBeenCalled();
  });
});
