import type { Route } from 'next';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ActivityCardView } from './activity-card-view';
import { ContributionCardView } from './contribution-card-view';
import type { ActivityItemVM, ContributionVM } from './types';

afterEach(cleanup);

const F = { id: 'u-f', name: 'Farida', initial: 'F', role: 'member' as const };
const N = { id: 'u-n', name: 'Novanda', initial: 'N', role: 'owner' as const };

const item = (over: Partial<ActivityItemVM> = {}): ActivityItemVM => ({
  key: 'e1:2',
  entryId: 'e1',
  actor: F,
  at: '2026-11-04T09:15:00+07:00',
  text: 'mengubah Makan siang',
  change: [],
  backdate: null,
  amount: 75_000,
  beforeAmount: null,
  moved: false,
  href: '/bersama/transaksi/e1' as ActivityItemVM['href'],
  ...over,
});

describe('ActivityCardView baris (S8-A1/A2)', () => {
  it('perubahan nominal: baris perubahan aria-hidden + srText, tanpa nominal kanan ganda', () => {
    render(
      <ActivityCardView
        today="2026-11-04"
        listHref={'/bersama/aktivitas' as Route}
        emptyNames="Farida"
        items={[
          item({
            change: ['Rp 50.000 → Rp 75.000'],
            srText: 'dari Rp 50.000 menjadi Rp 75.000',
            amount: null,
            beforeAmount: 50_000,
          }),
        ]}
      />,
    );
    const row = screen.getByRole('link', { name: /Farida\s· mengubah Makan siang/ });
    expect(row.textContent).toContain('Hari ini · 09.15');
    expect(row.querySelector('[aria-hidden="true"].flex-col')?.textContent).toContain('→');
    expect(row.querySelector('.sr-only')?.textContent).toBe('dari Rp 50.000 menjadi Rp 75.000');
    // Tidak ada MoneyText di kanan (hanya baris perubahan dan teks sr-only).
    expect(row.querySelector('.num.inline-block')).toBeNull();
  });

  it('tanggal mundur ditambahkan ke baris waktu; hari lain memakai nama hari', () => {
    render(
      <ActivityCardView
        today="2026-11-04"
        listHref={null}
        emptyNames={null}
        items={[
          item({ text: 'mencatat pengeluaran Parkir', backdate: 'tanggal 26 Okt' }),
          item({ key: 'e2:1', at: '2026-11-03T19:04:00+07:00' }),
        ]}
      />,
    );
    expect(screen.getByText('Hari ini · 09.15 · tanggal 26 Okt')).toBeTruthy();
    expect(screen.getByText('Kemarin · 19.04')).toBeTruthy();
  });

  it('nama 40 huruf dan kalimat panjang: break-words, dibatasi 4 baris, kata kerja ada', () => {
    const nama = 'N'.repeat(40);
    render(
      <ActivityCardView
        today="2026-11-04"
        listHref={null}
        emptyNames={null}
        items={[
          item({ actor: { ...F, name: nama }, text: `mencatat pengeluaran ${'x'.repeat(200)}` }),
        ]}
      />,
    );
    const clamp = document.querySelector('.line-clamp-4');
    expect(clamp?.className).toContain('break-words');
    expect(clamp?.textContent).toContain(`${nama}\u00a0· mencatat pengeluaran`);
  });

  it('baris tanpa target: li tanpa tautan; pelaku hilang: avatar netral', () => {
    render(
      <ActivityCardView
        today="2026-11-04"
        listHref={null}
        emptyNames={null}
        items={[
          item({ href: null, actor: { id: 'x', name: 'Anggota', initial: '?', role: null } }),
        ]}
      />,
    );
    const li = screen.getByRole('listitem');
    expect(within(li).queryByRole('link')).toBeNull();
    expect(li.querySelector('[data-initial]')?.className).not.toContain('bg-bersama-tint');
    expect(li.textContent).toContain('Anggota');
  });

  it('nominal 12 digit tidak dipecah (NBSP) dan tampil', () => {
    render(
      <ActivityCardView
        today="2026-11-04"
        listHref={null}
        emptyNames={null}
        items={[item({ amount: 12_345_678_900 })]}
      />,
    );
    expect(screen.getByRole('link').textContent).toContain('Rp 12.345.678.900');
  });
});

describe('ActivityItemRow pemisah nama dan kata kerja', () => {
  it('nama dan titik tengah dilekatkan (NBSP), kata kerja dipisah spasi biasa agar tidak terpotong', () => {
    render(
      <ActivityCardView
        today="2026-11-04"
        listHref={null}
        emptyNames={null}
        items={[item({ text: 'mengambil dari Bersama' })]}
      />,
    );
    const t = document.querySelector('.line-clamp-4')?.textContent ?? '';
    expect(t).toBe('Farida\u00a0· mengambil dari Bersama');
    expect(t).not.toContain('·\u00a0');
  });
});

describe('ContributionCardView (S8-K1)', () => {
  const vm = (over: Partial<ContributionVM> = {}): ContributionVM => ({
    period: { from: '2026-11-01', to: '2026-11-30', label: 'November' },
    rows: [
      { member: N, setoran: 12_345_678_900, diambil: 0 },
      { member: F, setoran: 0, diambil: 0 },
    ],
    allZero: false,
    ...over,
  });

  it('nominal 12 digit: whitespace-nowrap; Setor 0 muted; tanpa Diambil bila 0', () => {
    render(<ContributionCardView vm={vm()} />);
    const kartu = screen.getByRole('region', { name: 'Kontribusi November' });
    const dd = kartu.querySelectorAll('dd');
    expect(dd).toHaveLength(2);
    expect(dd[0]?.className).toContain('whitespace-nowrap');
    expect(dd[1]?.className).toContain('text-text-muted');
    expect(kartu.textContent).not.toContain('Diambil');
    expect(kartu.textContent).toContain('Rp 12.345.678.900');
  });

  it('dl terstruktur: dt Setor lalu Diambil bila > 0', () => {
    render(
      <ContributionCardView
        vm={vm({
          rows: [
            { member: N, setoran: 1_000, diambil: 400 },
            { member: F, setoran: 0, diambil: 0 },
          ],
        })}
      />,
    );
    const dts = [...document.querySelectorAll('dt')].map((d) => d.textContent);
    expect(dts).toEqual(['Setor', 'Diambil', 'Setor']);
  });
});

describe('ActivityCardView query', () => {
  it('query tema ikut ke tautan baris', () => {
    render(
      <ActivityCardView
        today="2026-11-04"
        listHref={null}
        emptyNames={null}
        query="?theme=dark"
        items={[item()]}
      />,
    );
    expect(screen.getByRole('link').getAttribute('href')).toBe('/bersama/transaksi/e1?theme=dark');
  });
});
