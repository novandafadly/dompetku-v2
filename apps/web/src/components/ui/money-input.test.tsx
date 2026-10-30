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
});
