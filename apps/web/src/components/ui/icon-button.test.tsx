import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IconButton } from './icon-button';

describe('IconButton', () => {
  it('label menjadi aria-label', () => {
    render(<IconButton label="Hapus" icon={<span />} />);
    expect(screen.getByRole('button', { name: 'Hapus' })).toBeInTheDocument();
  });

  it('tanpa label adalah error tipe', () => {
    // @ts-expect-error label wajib
    render(<IconButton icon={<span />} />);
    expect(true).toBe(true);
  });
});
