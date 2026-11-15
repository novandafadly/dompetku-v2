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
    const cls = screen.getByRole('alertdialog').className;
    expect(cls).toContain('max-h-[calc(100dvh-2rem)]');
    expect(cls).toContain('overflow-y-auto');
  });
});
