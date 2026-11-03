import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LazySheetProps } from './catat-slot';

/**
 * Review Focus 5 (mode tercampur): shell dengan `real` (mode nyata) memuat sheet Catat nyata saja;
 * modul sheet demo (dan store demo di belakangnya) tidak pernah diimpor, DemoProvider tidak
 * dibaca, dan penanda "Data demo" tidak tampil. Prototipe kebalikannya.
 */

const loaded = vi.hoisted(() => ({ demo: 0, real: 0 }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/pribadi/beranda',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('./catat-demo', () => {
  loaded.demo += 1;
  return {
    DemoCatatSheet: (p: LazySheetProps) => (p.open ? <p>Sheet demo {p.ruang}</p> : null),
  };
});

vi.mock('./_real/catat-real', () => {
  loaded.real += 1;
  return {
    RealCatatSheet: (p: LazySheetProps & { home: string; options: { accounts: unknown[] } }) =>
      p.open ? (
        <p>
          Sheet nyata {p.ruang} dari {p.home}, {String(p.options.accounts.length)} dompet
        </p>
      ) : null,
  };
});

const { NavProvider } = await import('@/features/shell/nav-provider');
const { RuangShell } = await import('./ruang-shell');

beforeEach(() => {
  loaded.demo = 0;
  loaded.real = 0;
});

async function openCatat() {
  const trigger = document.querySelector<HTMLElement>('[data-catat-trigger]');
  if (!trigger) throw new Error('tombol Catat tidak ada');
  await act(async () => {
    fireEvent.click(trigger);
    await Promise.resolve();
  });
}

describe('RuangShell', () => {
  it('mode nyata: sheet Catat nyata, modul demo tidak pernah dimuat, tanpa "Data demo"', async () => {
    render(
      <NavProvider today="2026-10-31">
        <RuangShell
          ruang="pribadi"
          real={{ options: { accounts: [], categories: [] }, today: '2026-10-31' }}
        >
          <p>isi</p>
        </RuangShell>
      </NavProvider>,
    );
    expect(screen.queryByText('Data demo')).toBeNull();
    await openCatat();
    expect(await screen.findByText('Sheet nyata pribadi dari pribadi, 0 dompet')).toBeVisible();
    // Tunggu preload senggang juga selesai: tetap hanya chunk nyata.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(loaded.real).toBe(1);
    expect(loaded.demo).toBe(0);
  });

  // Sesudah tes nyata (pabrik vi.mock hanya berjalan saat modul pertama kali diimpor).
  it('prototipe: sheet demo, penanda "Data demo" tampil, chunk nyata tidak dimuat', async () => {
    render(
      <NavProvider today="2026-10-31" prototype>
        <RuangShell ruang="pribadi">
          <p>isi</p>
        </RuangShell>
      </NavProvider>,
    );
    expect(screen.getAllByText('Data demo').length).toBeGreaterThan(0);
    await openCatat();
    expect(await screen.findByText('Sheet demo pribadi')).toBeVisible();
    expect(loaded.demo).toBe(1);
    expect(loaded.real).toBe(0);
  });
});
