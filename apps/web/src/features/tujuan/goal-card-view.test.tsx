import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { goal } from './__fixtures__/goal';
import { ClosedGoalRow, GoalCardView, type GoalCardSlots } from './goal-card-view';
import type { GoalVM } from './types';

afterEach(cleanup);

const SLOTS: GoalCardSlots = {
  complete: (g) => <button type="button">{`Selesaikan tujuan ${g.name}`}</button>,
  edit: (g) => <button type="button">{`Ubah tujuan ${g.name}`}</button>,
  archive: (g) => <button type="button">{`Arsipkan tujuan ${g.name}`}</button>,
};

function card(g: GoalVM, ruang: 'pribadi' | 'bersama' = 'pribadi', walletHref = true) {
  return render(
    <GoalCardView
      goal={g}
      ruang={ruang}
      slots={SLOTS}
      walletHref={walletHref ? ('/pribadi/dompet/a1' as never) : null}
    />,
  );
}

describe('GoalCardView: keadaan (bingkai S13-TJ3)', () => {
  it('berjalan dengan tanggal: angka, persen, Sisa, Perlu per bulan + penjelasan, bilah ber-ARIA', () => {
    card(goal());
    const region = screen.getByRole('region', { name: 'Dana darurat' });
    expect(region).toHaveTextContent(/Rp\s4\.500\.000/);
    expect(region).toHaveTextContent(/dari Rp\s10\.000\.000/);
    expect(region).toHaveTextContent('45%');
    expect(region).toHaveTextContent(/Sisa Rp\s5\.500\.000/);
    expect(region).toHaveTextContent(/Perlu Rp\s1\.375\.000\/bulan sampai 25 Mar 2027/);
    expect(region).toHaveTextContent('Dihitung per periode gajian');
    const bar = screen.getByRole('progressbar', { name: 'Dana darurat' });
    expect(bar).toHaveAttribute('aria-valuenow', '45');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar.getAttribute('aria-valuetext')).toMatch(
      /^45 persen, Rp\s4\.500\.000 dari Rp\s10\.000\.000$/,
    );
    expect(region).not.toHaveTextContent('Tercapai');
    expect(screen.queryByRole('button', { name: /^Selesaikan tujuan/ })).toBeNull();
  });

  it('satu periode tersisa: tanpa /bulan', () => {
    card(goal({ periodsLeft: 1, perPeriod: 5_500_000 }));
    const text = screen.getByRole('region').textContent;
    expect(text).toMatch(/Perlu Rp\s5\.500\.000 sampai 25 Mar 2027/);
    expect(text).not.toContain('/bulan');
  });

  it('tanpa tanggal: hanya Sisa, tanpa Perlu', () => {
    card(goal({ targetOn: null, periodsLeft: null, perPeriod: null }));
    const text = screen.getByRole('region').textContent;
    expect(text).toContain('Sisa');
    expect(text).not.toContain('Perlu');
  });

  it('kurang dari 1%: teks persen tidak 0%', () => {
    card(goal({ saved: 50_000, balance: 50_000, pct: 0, remaining: 9_950_000 }));
    expect(screen.getByRole('region')).toHaveTextContent('Kurang dari 1%');
    expect(screen.getByRole('region').textContent).not.toContain('0%');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('saldo 0: Belum ada yang terkumpul, tanpa Rp 0, Target dan Isi lewat Transfer', () => {
    card(goal({ saved: 0, balance: 0, pct: 0, remaining: 10_000_000 }));
    const text = screen.getByRole('region').textContent ?? '';
    expect(text).toContain('Belum ada yang terkumpul');
    expect(text).toMatch(/Target Rp\s10\.000\.000/);
    expect(text).toContain('Isi lewat Transfer ke Tabungan BCA.');
    expect(text).not.toMatch(/Rp\s0(?![.\d])/);
    expect(text).not.toContain('Sisa');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toMatch(
      /^Belum ada yang terkumpul dari Rp\s10\.000\.000$/,
    );
  });

  it('saldo minus: kalimat minus, progres 0%, tanpa Rp negatif', () => {
    card(goal({ saved: 0, balance: -250_000, pct: 0, remaining: 10_250_000 }));
    const text = screen.getByRole('region').textContent ?? '';
    expect(text).toContain('Saldo Tabungan BCA sedang minus, jadi progres dihitung 0%.');
    expect(text).not.toContain('-');
    expect(text).not.toContain('Isi lewat Transfer');
  });

  it('tercapai: status ikon + teks, Selesaikan tujuan, tanpa Sisa/Perlu, bilah penuh', () => {
    card(
      goal({
        reached: true,
        balance: 10_250_000,
        saved: 10_250_000,
        pct: 100,
        remaining: 0,
        periodsLeft: 4,
        perPeriod: null,
      }),
    );
    const region = screen.getByRole('region');
    expect(region).toHaveTextContent('Tercapai');
    expect(region).toHaveTextContent(
      'Selesaikan supaya Tabungan BCA bisa dipakai untuk tujuan baru.',
    );
    expect(region).toHaveTextContent('100%');
    expect(region.textContent).not.toContain('Sisa');
    expect(region.textContent).not.toContain('Perlu');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    // Urutan fokus: Selesaikan tujuan lebih dulu.
    const buttons = within(region).getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Selesaikan tujuan');
  });

  it('lewat tanggal target: netral (tanpa warna bahaya/peringatan), Sisa + ajakan ubah tanggal, tanpa Perlu', () => {
    card(goal({ periodsLeft: null, perPeriod: null, targetOn: '2026-10-01' }));
    const region = screen.getByRole('region');
    expect(region).toHaveTextContent('Lewat tanggal target');
    expect(region).toHaveTextContent(
      'Target 1 Okt 2026 sudah lewat. Ubah tanggal atau hapus tanggalnya.',
    );
    expect(region.textContent).not.toContain('Perlu');
    expect(region.innerHTML).not.toMatch(/text-danger|text-warning|bg-danger|bg-warning/);
  });

  it('bilah satu warna ruang di semua persen, tidak pernah merah/amber', () => {
    for (const [ruang, cls] of [
      ['pribadi', 'bg-pribadi'],
      ['bersama', 'bg-bersama'],
    ] as const) {
      for (const pct of [0, 5, 45, 99, 100]) {
        const { unmount } = card(goal({ pct }), ruang);
        const fill = screen.getByRole('progressbar').firstElementChild as HTMLElement;
        expect(fill.className).toContain(cls);
        expect(fill.style.width).toBe(`${String(pct)}%`);
        expect(screen.getByRole('region').innerHTML).not.toMatch(/danger|warning/);
        unmount();
      }
    }
  });

  it('Dibuat {nama} hanya bila diisi; Lihat dompet hanya dengan tautan; tanpa kata Goal', () => {
    card(goal({ createdByName: 'Farida' }));
    expect(screen.getByRole('region')).toHaveTextContent('Dibuat Farida');
    expect(screen.getByRole('link', { name: 'Lihat dompet Tabungan BCA' })).toHaveAttribute(
      'href',
      '/pribadi/dompet/a1',
    );
    expect(document.body.textContent?.toLowerCase()).not.toContain('goal');
    cleanup();
    card(goal(), 'pribadi', false);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('region').textContent).not.toContain('Dibuat');
  });

  it('nama 60 huruf dan nominal panjang tidak merusak struktur (judul = nama lengkap)', () => {
    const name = 'N'.repeat(60);
    card(goal({ name, saved: 12_345_678_900, balance: 12_345_678_900, target: 12_345_678_900 }));
    expect(screen.getByRole('heading', { level: 3 })).toHaveAttribute('title', name);
    expect(screen.getByRole('region')).toHaveTextContent(/Rp\s12\.345\.678\.900/);
  });
});

describe('ClosedGoalRow (TJ2/TJ8)', () => {
  const restore = (g: GoalVM) => <button type="button">{`Pulihkan tujuan ${g.name}`}</button>;
  const row = (g: GoalVM) =>
    render(
      <ul>
        <ClosedGoalRow goal={g} restore={restore} />
      </ul>,
    );

  it('selesai: tanggal, dompet, target; tanpa bilah dan persen; Pulihkan', () => {
    row(goal({ status: 'completed', completedOn: '2026-11-10' }));
    const li = screen.getByRole('listitem');
    expect(li).toHaveTextContent(/Selesai 10 Nov 2026 · Tabungan BCA · target Rp\s10\.000\.000/);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(li.textContent).not.toContain('%');
    expect(screen.getByRole('button', { name: 'Pulihkan tujuan Dana darurat' })).toBeTruthy();
  });

  it('diarsipkan dengan dompet terarsip: tanpa Pulihkan, ada Dompet sudah diarsipkan', () => {
    row(goal({ status: 'archived', archivedOn: '2026-11-11', accountArchived: true }));
    expect(screen.getByRole('listitem')).toHaveTextContent('Diarsipkan 11 Nov 2026');
    expect(screen.getByRole('listitem')).toHaveTextContent('Dompet sudah diarsipkan');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('dompet sudah dipakai tujuan aktif lain: kalimat, bukan tombol', () => {
    row(goal({ status: 'archived', archivedOn: '2026-11-11', accountHasOtherActive: true }));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Tabungan BCA sudah punya tujuan aktif/)).toBeTruthy();
  });
});
