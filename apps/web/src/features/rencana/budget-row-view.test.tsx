import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BudgetItemView, BudgetTotalCard, UnbudgetedItemView } from './budget-row-view';
import type { BudgetOverviewVM } from './types';

afterEach(cleanup);

const row = (over: Partial<BudgetOverviewVM>): BudgetOverviewVM => ({
  categoryId: 'k1',
  name: 'Makan Siang & Minum',
  icon: 'ForkKnife',
  budget: 1_000_000,
  wajib: false,
  spent: 250_000,
  pct: 25,
  remaining: 750_000,
  archived: false,
  ...over,
});

/** Teks yang terlihat: teks sr-only (ucapan nominal, "Atur anggaran …") dibuang. */
const text = (el: HTMLElement) => {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.sr-only').forEach((n) => {
    n.remove();
  });
  return copy.textContent.replace(/\s+/g, ' ').trim();
};

describe('BudgetItemView', () => {
  it('di bawah ambang: persen terpakai tanpa ikon status, sub dengan sisa', () => {
    const { container } = render(<BudgetItemView row={row({})} />);
    expect(text(container)).toContain('25% terpakai');
    expect(text(container)).toContain('Rp 250.000 dari Rp 1.000.000 · sisa Rp 750.000');
    expect(container.querySelector('svg[width="16"]')).toBeTruthy(); // hanya caret
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it('tag Wajib hanya untuk anggaran wajib', () => {
    const { container, rerender } = render(<BudgetItemView row={row({})} />);
    expect(text(container)).not.toContain('Wajib');
    rerender(<BudgetItemView row={row({ wajib: true })} />);
    expect(text(container)).toContain('Wajib');
  });

  it('80%: peringatan (ikon + teks); tepat habis: Terpakai penuh; lewat: Lewat Rp …', () => {
    const near = render(
      <BudgetItemView row={row({ spent: 800_000, pct: 80, remaining: 200_000 })} />,
    );
    expect(text(near.container)).toContain('80% terpakai');
    expect(near.container.querySelectorAll('svg')).toHaveLength(2);
    cleanup();
    const full = render(<BudgetItemView row={row({ spent: 1_000_000, pct: 100, remaining: 0 })} />);
    expect(text(full.container)).toContain('Terpakai penuh');
    expect(text(full.container)).toContain('· sisa Rp 0');
    cleanup();
    const over = render(
      <BudgetItemView row={row({ spent: 1_200_000, pct: 120, remaining: -200_000 })} />,
    );
    expect(text(over.container)).toContain('Lewat Rp 200.000');
    expect(text(over.container)).not.toContain('· sisa');
  });

  it('bilah mengisi paling banyak 100% dan tersembunyi dari pembaca layar', () => {
    const { container } = render(
      <BudgetItemView row={row({ spent: 3_000_000, pct: 300, remaining: -2_000_000 })} />,
    );
    const bar = container.querySelector<HTMLElement>('[aria-hidden="true"] > span');
    expect(bar?.style.width).toBe('100%');
  });

  it('nominal sangat besar tetap terbaca (teks sr-only dari MoneyText)', () => {
    render(
      <BudgetItemView
        row={row({ budget: 12_345_678_900, spent: 12_345_678_900, pct: 100, remaining: 0 })}
      />,
    );
    expect(
      screen.getAllByText('Rp 12.345.678.900', { selector: '.sr-only' }).length,
    ).toBeGreaterThan(0);
  });
});

describe('UnbudgetedItemView', () => {
  it('terpakai > 0: Rp … periode ini; nol: Belum ada pengeluaran; label Atur punya nama lengkap', () => {
    const { container, rerender } = render(
      <UnbudgetedItemView row={row({ budget: null, pct: null, remaining: null, spent: 85_000 })} />,
    );
    expect(text(container)).toContain('Rp 85.000 periode ini');
    expect(container.textContent).toContain('Atur anggaran Makan Siang & Minum');
    rerender(
      <UnbudgetedItemView row={row({ budget: null, pct: null, remaining: null, spent: 0 })} />,
    );
    expect(text(container)).toContain('Belum ada pengeluaran');
    expect(text(container)).not.toContain('periode ini');
  });
});

describe('BudgetTotalCard', () => {
  it('menampilkan total dari SQL; sr-only "dari anggaran"', () => {
    render(
      <BudgetTotalCard
        labelledBy="t"
        totals={{ budget: 2_000_000, spent: 1_000_000, remaining: 1_000_000, pct: 50 }}
      />,
    );
    const card = screen.getByRole('region', { name: /Terpakai/ });
    expect(within(card).getByText('dari anggaran')).toBeTruthy();
    expect(text(card)).toContain('Rp 1.000.000');
    expect(text(card)).toContain('dari Rp 2.000.000');
    expect(text(card)).toContain('sisa Rp 1.000.000');
  });

  it('total lewat: Lewat Rp …', () => {
    render(
      <BudgetTotalCard
        labelledBy="t"
        totals={{ budget: 100_000, spent: 150_000, remaining: -50_000, pct: 150 }}
      />,
    );
    expect(text(screen.getByRole('region'))).toContain('Lewat Rp 50.000');
  });
});
