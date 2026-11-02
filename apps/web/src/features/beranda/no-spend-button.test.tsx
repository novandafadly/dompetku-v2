import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoSpendButton } from './no-spend-button';

const LABEL = 'Tidak ada pengeluaran hari ini';
const DONE = 'Hari ini tercatat tanpa pengeluaran.';

function deferred() {
  let resolve: (v: { ok: boolean }) => void = () => undefined;
  const promise = new Promise<{ ok: boolean }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('NoSpendButton (S6-B1)', () => {
  it('tampil hanya bila belum ada entri hari ini dan hari belum ditandai', () => {
    const onMark = vi.fn(() => Promise.resolve({ ok: true }));
    const { rerender } = render(
      <NoSpendButton hasEntry={false} noSpendMarked={false} onMark={onMark} />,
    );
    expect(screen.getByRole('button', { name: LABEL })).toBeVisible();

    rerender(<NoSpendButton hasEntry noSpendMarked={false} onMark={onMark} />);
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    rerender(<NoSpendButton hasEntry={false} noSpendMarked onMark={onMark} />);
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull();
    // Sudah ditandai sebelumnya: baris status, tanpa merebut fokus.
    expect(screen.getByRole('status')).toHaveTextContent(DONE);
    expect(screen.getByRole('status')).not.toHaveFocus();
  });

  it('aria-busy selama memanggil server; sukses = baris status role=status yang menerima fokus', async () => {
    const d = deferred();
    const onMark = vi.fn(() => d.promise);
    render(<NoSpendButton hasEntry={false} noSpendMarked={false} onMark={onMark} />);
    const button = screen.getByRole('button', { name: LABEL });
    button.focus();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Fokus tidak jatuh ke <body>: tombol tidak memakai atribut disabled.
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onMark).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve({ ok: true });
      await d.promise;
    });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(DONE);
    expect(status).toHaveAttribute('tabindex', '-1');
    expect(status).toHaveFocus();
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull();
  });

  it('gagal: tombol tetap ada dan galat role=alert; coba lagi memanggil ulang', async () => {
    const onMark = vi.fn(() => Promise.resolve({ ok: false }));
    render(<NoSpendButton hasEntry={false} noSpendMarked={false} onMark={onMark} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: LABEL }));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Belum bisa ditandai. Periksa koneksi lalu coba lagi.',
    );
    const button = screen.getByRole('button', { name: LABEL });
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).toHaveAccessibleDescription(
      'Belum bisa ditandai. Periksa koneksi lalu coba lagi.',
    );
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(onMark).toHaveBeenCalledTimes(2);
  });

  it('onMark yang melempar diperlakukan sebagai gagal', async () => {
    const onMark = vi.fn(() => Promise.reject(new Error('putus')));
    render(<NoSpendButton hasEntry={false} noSpendMarked={false} onMark={onMark} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: LABEL }));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toBeVisible();
  });
});
