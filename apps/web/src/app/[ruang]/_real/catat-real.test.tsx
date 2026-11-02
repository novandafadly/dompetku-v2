import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./catat-source-real', () => ({ realCatatSource: vi.fn() }));

const { useSessionValue } = await import('./catat-real');

describe('useSessionValue: satu sumber Catat per sheet dibuka', () => {
  it('dibuat saat dibuka, tetap selama terbuka dan sesudah ditutup, baru lagi saat dibuka ulang', () => {
    let n = 0;
    const create = vi.fn(() => ({ id: ++n }));
    const { result, rerender } = renderHook(
      ({ open, version }: { open: boolean; version: number }) =>
        useSessionValue(open, () => ({ ...create(), version })),
      { initialProps: { open: true, version: 1 } },
    );
    const first = result.current;
    expect(first).toEqual({ id: 1, version: 1 });

    // Props layout berubah (router.refresh sesudah simpan) selagi terbuka: sumber tetap.
    rerender({ open: true, version: 2 });
    expect(result.current).toBe(first);
    rerender({ open: false, version: 2 });
    expect(result.current).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);

    // Dibuka lagi: sumber baru dari props terbaru (opsi, saldo, chip tidak basi).
    rerender({ open: true, version: 3 });
    expect(result.current).toEqual({ id: 2, version: 3 });
    expect(result.current).not.toBe(first);
    rerender({ open: true, version: 4 });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('lahir tertutup: belum ada sumber sampai dibuka', () => {
    const create = vi.fn(() => ({}));
    const { result, rerender } = renderHook(({ open }) => useSessionValue(open, create), {
      initialProps: { open: false },
    });
    expect(result.current).toBeNull();
    expect(create).not.toHaveBeenCalled();
    rerender({ open: true });
    expect(result.current).not.toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
