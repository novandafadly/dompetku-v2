import { createSeed } from '@dompetku/demo-data';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BerandaPage } from './view';

afterEach(cleanup);

const TODAY = '2026-10-29';
const state = createSeed({ today: TODAY, variant: 'full' });
let ruang: 'pribadi' | 'bersama' = 'bersama';

vi.mock('@/features/shell/demo-context', () => ({
  useDemo: () => ({
    state,
    store: {},
    ruang,
    today: TODAY,
    authHref: () => '/undang',
    href: () => '/x',
    entryHref: () => '/x',
    dataState: 'ready',
    retry: () => undefined,
  }),
}));
vi.mock('@/features/shell/catat', () => ({
  useOpenCatat: () => () => undefined,
  usePreloadCatat: () => () => undefined,
}));
vi.mock('@/features/shell/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('@/features/beranda/safe-to-spend', () => ({
  SafeToSpend: () => <div />,
  SafeToSpendEmpty: () => <div />,
}));
vi.mock('@/features/beranda/bills-soon', () => ({ BillsSoon: () => <div /> }));
vi.mock('@/features/beranda/budgets-near-limit', () => ({ BudgetsNearLimit: () => <div /> }));
vi.mock('@/features/beranda/recent-entries', () => ({ RecentEntries: () => <div /> }));
vi.mock('@/features/beranda/onboarding-checklist', () => ({ OnboardingChecklist: () => <div /> }));

describe('BerandaPage prototipe: Kontribusi demo dimuat malas', () => {
  it('Bersama: kartu Kontribusi muncul sesudah muat malas; ActivityFeed tetap', async () => {
    ruang = 'bersama';
    render(<BerandaPage />);
    expect(screen.getByRole('region', { name: 'Aktivitas' })).toBeTruthy();
    expect(await screen.findByRole('region', { name: 'Kontribusi Oktober' })).toBeTruthy();
  });

  it('Pribadi: tanpa kartu Kontribusi dan Aktivitas', async () => {
    ruang = 'pribadi';
    render(<BerandaPage />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('region', { name: /Kontribusi/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Aktivitas' })).toBeNull();
  });
});
