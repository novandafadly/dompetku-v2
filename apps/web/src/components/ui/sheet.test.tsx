import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Sheet } from './sheet';
import { ToastList } from './toast-list';
import { dismissToast, toast, useToasts } from './toast-store';

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

  describe('toast sudah tampil saat sheet dibuka', () => {
    afterEach(() => {
      render(<DismissAllToasts />).unmount();
    });

    /** Escape tepat saat fokus awal masuk ke sheet (sebelum Radix menjadikannya lapisan teratas). */
    function escapeOnFirstFocus() {
      const on = (e: FocusEvent) => {
        if (!(e.target instanceof HTMLElement) || !e.target.closest('[role="dialog"]')) return;
        document.removeEventListener('focusin', on, true);
        e.target.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
      };
      document.addEventListener('focusin', on, true);
    }

    it('Escape pada fokus pertama tetap menutup sheet (tidak jatuh ke lapisan toast)', async () => {
      const user = userEvent.setup();
      const announcer = document.createElement('div');
      document.body.append(announcer);
      render(
        <>
          <Harness />
          <ToastList announcer={announcer} />
        </>,
      );
      act(() => {
        toast({ message: 'Tersimpan' });
      });
      expect(await screen.findByText('Tersimpan')).toBeInTheDocument();
      escapeOnFirstFocus();
      await user.click(screen.getByRole('button', { name: 'Buka' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('Escape di elemen data-own-escape tidak menutup sheet', async () => {
      const user = userEvent.setup();
      const announcer = document.createElement('div');
      document.body.append(announcer);
      function OwnEscape() {
        const [open, setOpen] = useState(false);
        const ref = useRef<HTMLInputElement>(null);
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
            <Sheet open={open} onOpenChange={setOpen} title="Catat" initialFocus={ref}>
              <div data-own-escape="">
                <input aria-label="Cari" ref={ref} />
              </div>
            </Sheet>
          </>
        );
      }
      render(
        <>
          <OwnEscape />
          <ToastList announcer={announcer} />
        </>,
      );
      act(() => {
        toast({ message: 'Tersimpan' });
      });
      expect(await screen.findByText('Tersimpan')).toBeInTheDocument();
      escapeOnFirstFocus();
      await user.click(screen.getByRole('button', { name: 'Buka' }));
      expect(await screen.findByRole('dialog', { name: 'Catat' })).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: 'Cari' })).toHaveFocus();
      });
      expect(screen.getByRole('dialog', { name: 'Catat' })).toBeInTheDocument();
    });
  });
});

/** Kosongkan store toast (modul global) antar tes. */
function DismissAllToasts() {
  const items = useToasts();
  useEffect(() => {
    for (const t of items) dismissToast(t.id);
  }, [items]);
  return null;
}
