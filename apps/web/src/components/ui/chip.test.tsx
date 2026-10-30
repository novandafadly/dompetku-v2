import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Chip, ChipGroup } from './chip';

function Harness() {
  const [v, setV] = useState('a');
  return (
    <ChipGroup label="Filter">
      {['a', 'b', 'c'].map((x) => (
        <Chip
          key={x}
          selected={v === x}
          onSelect={() => {
            setV(x);
          }}
        >
          {x.toUpperCase()}
        </Chip>
      ))}
    </ChipGroup>
  );
}

describe('ChipGroup', () => {
  it('panah kiri/kanan memindah pilihan', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Filter' })).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole('radio', { name: 'A' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'B' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'B' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'C' })).toBeChecked();
  });
});
