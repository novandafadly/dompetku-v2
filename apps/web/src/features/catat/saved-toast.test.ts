import { describe, expect, it, vi } from 'vitest';
import { undoOrNotify, undoVoidOnce, UNDO_FAILED, UNDO_VOID_FAILED } from './saved-toast';

const saved = { entryId: 'e1', version: 1, ruang: 'pribadi' as const };
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

describe('undoVoidOnce (Urungkan sesudah Batalkan di Detail)', () => {
  it('gagal → salinan pulihkan, bukan salinan Catat', async () => {
    const notify = vi.fn();
    const restore = vi.fn(() => Promise.resolve({ ok: false }));
    const run = undoVoidOnce(restore, 'e1', 4, notify);
    await run();
    expect(notify).toHaveBeenCalledWith({ message: UNDO_VOID_FAILED, tone: 'info' });
    expect(UNDO_VOID_FAILED).toBe('Belum bisa diurungkan. Buka transaksi itu untuk memulihkannya.');
  });

  it('klik berulang pada satu toast memakai clientId yang sama', async () => {
    const notify = vi.fn();
    const restore = vi
      .fn<
        (req: {
          clientId: string;
          entryId: string;
          expectedVersion: number;
        }) => Promise<{ ok: boolean }>
      >()
      .mockRejectedValueOnce(new Error('putus'))
      .mockResolvedValueOnce({ ok: true });
    const run = undoVoidOnce(restore, 'e1', 4, notify);
    await run();
    await run();
    expect(restore).toHaveBeenCalledTimes(2);
    const [first, second] = restore.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ entryId: 'e1', expectedVersion: 4 });
    expect(first?.clientId).toMatch(UUID_V4);
    expect(second?.clientId).toBe(first?.clientId);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('toast lain = clientId baru', async () => {
    const restore = vi.fn(() => Promise.resolve({ ok: true }));
    await undoVoidOnce(restore, 'e1', 4, vi.fn())();
    await undoVoidOnce(restore, 'e1', 4, vi.fn())();
    const ids = restore.mock.calls.map((c) => (c as unknown as [{ clientId: string }])[0].clientId);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('klik ganda saat permintaan masih jalan = satu permintaan', async () => {
    let done: (v: { ok: boolean }) => void = () => undefined;
    const restore = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((r) => {
          done = r;
        }),
    );
    const run = undoVoidOnce(restore, 'e1', 4, vi.fn());
    const a = run();
    const b = run();
    done({ ok: true });
    await Promise.all([a, b]);
    expect(restore).toHaveBeenCalledTimes(1);
  });
});
