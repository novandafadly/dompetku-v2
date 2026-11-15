import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('isi yang lebih tinggi dari layar menggulir (S12S13-C3: 320x640 memotong dialog Hapus tagihan)', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        title="Judul"
        description="Isi panjang"
        confirmLabel="Ya"
        cancelLabel="Kembali"
        onConfirm={() => undefined}
      />,
    );
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.style.maxHeight).toBe('calc(100dvh - 2rem)');
    expect(dialog.className).toContain('overflow-y-auto');
  });
});
