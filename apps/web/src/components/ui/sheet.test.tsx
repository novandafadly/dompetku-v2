import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Sheet } from './sheet';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Buka
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Catat">
        <input aria-label="Isi" />
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('Escape menutup dan fokus kembali ke pemicu', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Buka' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Catat' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });
});
