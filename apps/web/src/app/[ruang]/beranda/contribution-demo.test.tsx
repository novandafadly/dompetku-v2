import { createDemoStore, createSeed, type DemoState } from '@dompetku/demo-data';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ContributionDemo } from './contribution-demo';

afterEach(cleanup);

const TODAY = '2026-10-29';

function withSetoran(): DemoState {
  const store = createDemoStore(createSeed({ today: TODAY, variant: 'full' }));
  const s = store.getState();
  const into = s.accounts.find((a) => a.ruang === 'bersama' && a.pocket === 'operasional');
  const farida = s.members[1];
  if (!into || !farida) throw new Error('seed');
  store.addEntry({
    ruang: 'bersama',
    kind: 'space_transfer',
    direction: 'in',
    accountId: into.id,
    createdBy: farida.id,
    amount: 2_000_000,
    occurredOn: '2026-10-05',
    linkId: 'demo-k',
  });
  return store.getState();
}

describe('ContributionDemo (prototipe Bersama)', () => {
  it('kartu Kontribusi bulan ini dari seed: pemilik dulu, Farida Setor sesudah transfer', () => {
    render(<ContributionDemo state={withSetoran()} today={TODAY} />);
    const kartu = screen.getByRole('region', { name: 'Kontribusi Oktober' });
    const blok = within(kartu).getAllByRole('listitem');
    expect(blok[0]?.textContent).toContain('Novanda');
    expect(blok[1]?.textContent).toContain('Farida');
    expect(blok[1]?.textContent).toMatch(/Setor.*2\.000\.000/);
    expect(kartu.textContent).not.toMatch(/dompet/i);
  });

  it('periode tanpa transaksi: EmptyLine', () => {
    const empty = createSeed({ today: TODAY, variant: 'empty' });
    render(<ContributionDemo state={empty} today={TODAY} />);
    expect(screen.getByText('Belum ada setoran atau pengambilan bulan ini.')).toBeTruthy();
  });
});
