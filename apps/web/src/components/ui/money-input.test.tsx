import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Rupiah } from '@dompetku/domain';
import { MoneyInput } from './money-input';

function Harness({
  onValue,
  initial = null,
}: {
  onValue: (v: Rupiah | null) => void;
  initial?: Rupiah | null;
}) {
  const [value, setValue] = useState<Rupiah | null>(initial);
  return (
    <MoneyInput
      label="Nominal"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue(v);
      }}
    />
  );
}

describe('MoneyInput', () => {
  it('typing: menampilkan pemisah ribuan dan mengirim bilangan bulat', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText('Nominal');
    await user.type(input, '35000');
    expect(input).toHaveValue('35.000');
    expect(onValue).toHaveBeenLastCalledWith(35000);
    expect(input).toHaveAttribute('inputmode', 'numeric');
  });

  it('paste: menerima "Rp 1.250.000" dan "1.250.000"', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText('Nominal');
    await user.click(input);
    await user.paste('Rp 1.250.000');
    expect(onValue).toHaveBeenLastCalledWith(1250000);
    expect(input).toHaveValue('1.250.000');
    await user.clear(input);
    await user.paste('1.250.000');
    expect(onValue).toHaveBeenLastCalledWith(1250000);
  });

  it.each(['-5000', '1e3'])(
    'paste "%s": ditolak diam, nilai tetap, tanpa aria-invalid',
    async (text) => {
      const onValue = vi.fn();
      const user = userEvent.setup();
      render(<Harness onValue={onValue} initial={2000} />);
      const input = screen.getByLabelText('Nominal');
      await user.click(input);
      await user.paste(text);
      expect(onValue).not.toHaveBeenCalled();
      expect(input).toHaveValue('2.000');
      expect(input).not.toHaveAttribute('aria-invalid', 'true');
    },
  );

  it('mengosongkan input mengirim null', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} initial={5} />);
    await user.clear(screen.getByLabelText('Nominal'));
    expect(onValue).toHaveBeenLastCalledWith(null);
  });

  it('mengetik di tengah: caret tetap tepat setelah angka baru', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText<HTMLInputElement>('Nominal');
    await user.type(input, '1250000');
    expect(input).toHaveValue('1.250.000');
    input.setSelectionRange(3, 3); // setelah "1.2"
    await user.keyboard('9');
    expect(onValue).toHaveBeenLastCalledWith(12950000);
    expect(input).toHaveValue('12.950.000');
    expect(input.selectionStart).toBe(4); // "12.9|50.000"
    expect(input.selectionEnd).toBe(4);
  });

  it('paste "000" menimpa seleksi dan caret berada setelah sisipan', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} initial={1250000} />);
    const input = screen.getByLabelText<HTMLInputElement>('Nominal');
    await user.click(input);
    input.setSelectionRange(2, 5); // "250"
    await user.paste('000');
    expect(onValue).toHaveBeenLastCalledWith(1000000);
    expect(input).toHaveValue('1.000.000');
    expect(input.selectionStart).toBe(5); // "1.000|.000"
  });
});
