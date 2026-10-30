import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MoneyText } from './money-text';

const NBSP = ' ';

describe('MoneyText', () => {
  it('negatif pengeluaran: tampil −Rp 35.000, sr-only "pengeluaran Rp 35.000"', () => {
    const { container } = render(<MoneyText value={-35000} kind="expense" />);
    const visible = container.querySelector('[aria-hidden="true"]');
    expect(visible?.textContent).toBe(`−Rp${NBSP}35.000`);
    expect(container.querySelector('.sr-only')?.textContent).toBe('pengeluaran Rp 35.000');
  });

  it('"Rp" berwarna text-muted', () => {
    const { container } = render(<MoneyText value={1250000} />);
    const rp = container.querySelector('.text-text-muted');
    expect(rp?.textContent).toBe('Rp');
  });

  it('compact memakai formatRupiahCompact', () => {
    const { container } = render(<MoneyText value={1250000} compact />);
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe(`Rp${NBSP}1,25 jt`);
  });

  it('netral tanpa awalan, nol tanpa tanda', () => {
    const { container } = render(<MoneyText value={0} />);
    expect(container.querySelector('.sr-only')?.textContent).toBe('Rp 0');
  });
});
