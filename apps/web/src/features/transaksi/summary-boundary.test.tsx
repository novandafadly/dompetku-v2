import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SummaryBoundary } from './entry-list';

function Boom(): never {
  throw new Error('chunk gagal dimuat');
}

describe('SummaryBoundary (ringkasan demo dimuat malas)', () => {
  it('chunk gagal: pesan singkat role=alert, bukan layar galat', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <SummaryBoundary>
        <Boom />
      </SummaryBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Ringkasan belum bisa dimuat. Muat ulang halaman untuk mencoba lagi.',
    );
    err.mockRestore();
  });

  it('tanpa galat: isi dirender apa adanya', () => {
    render(
      <SummaryBoundary>
        <p>Ringkasan</p>
      </SummaryBoundary>,
    );
    expect(screen.getByText('Ringkasan')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
