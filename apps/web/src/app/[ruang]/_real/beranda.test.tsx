import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityItemVM, ContributionVM, MemberVM } from '@/features/bersama/types';
import type { BerandaData } from '@/server/ledger/beranda';
import { BerandaReal } from './beranda';

afterEach(cleanup);

vi.mock('./beranda-islands', () => ({
  NoSpendIsland: () => <button type="button">Tanpa pengeluaran hari ini</button>,
  CatatStepIsland: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
vi.mock('../_actions/beranda', () => ({ markNoSpendDayAction: vi.fn() }));
vi.mock('@/features/shell/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => (
    <header>
      <h1>{title}</h1>
    </header>
  ),
}));

/** Bagian S9 aman dipakai (loader Task 9; tampilannya Task 12). */
const S9_SAFE = {
  until: '2026-11-30',
  daysLeft: 27,
  perDay: 37_037,
  status: 'aman',
  reason: null,
  hasObligations: false,
} as const;

const base: BerandaData = {
  period: {
    label: 'November 2026 · 1 Nov – 30 Nov',
    from: '2026-11-01',
    to: '2026-11-30',
    labelMonth: '2026-11-01',
    daysLeft: 27,
    holidaysKnown: true,
    basis: 'kalender',
  },
  safe: {
    operasional: 1_000_000,
    billsUntilEom: 0,
    budgetWajibRemaining: 0,
    aman: 1_000_000,
    ...S9_SAFE,
  },
  billsDue: { items: [], hasBills: false },
  budgetsNear: { items: [], hasBudgets: false },
  today: { hasExpense: false, noSpendMarked: false },
  hasOperasional: true,
  hasExpense: false,
  recent: [],
  invite: false,
  bersama: null,
};

function view(over: Partial<BerandaData>, ruang: 'pribadi' | 'bersama' = 'bersama'): ReactNode {
  return <BerandaReal ruang={ruang} today="2026-11-04" query="" data={{ ...base, ...over }} />;
}

/** Bacaan S8 (feed, Kontribusi, partner) tidak dimuat: kartu S8 belum dirender (Task 6). */
const S8_NONE = { partner: null, activity: null, contributions: null };

const INTRO = /^Ruang untuk keuangan bersama\.$/;
const AKTIVITAS = /Belum ada aktivitas\. Yang dicatat di Bersama akan muncul di sini/;

describe('BerandaReal Bersama solo (S7-B1)', () => {
  it('pemilik, belum ada undangan: kartu ajakan, pengantar checklist, Aktivitas kosong', () => {
    render(
      view({
        bersama: { ...S8_NONE, members: 1, isOwner: true, empty: false, pendingInvite: null },
      }),
    );
    const ajakan = screen.getByRole('region', { name: 'Farida belum bergabung di Bersama.' });
    const link = within(ajakan).getByRole('link', { name: 'Undang Farida ke Bersama' });
    expect(link.getAttribute('href')).toBe('/undang');
    expect(link.textContent).toBe('Undang Farida');
    expect(screen.getByText(INTRO)).toBeTruthy();
    expect(screen.queryByText(/kamu dan Farida sama-sama/i)).toBeNull();
    expect(screen.getByRole('region', { name: 'Aktivitas' })).toBeTruthy();
    expect(screen.getByText(AKTIVITAS)).toBeTruthy();
    // Tanpa avatar/inisial anggota kedua.
    expect(screen.queryByText(/^F$/)).toBeNull();
  });

  it('pemilik, undangan menunggu: email dan tanggal, tombol Kelola undangan', () => {
    render(
      view({
        bersama: {
          ...S8_NONE,
          members: 1,
          isOwner: true,
          empty: false,
          pendingInvite: { email: 'farida@example.test', expiresOn: '2026-11-07' },
        },
      }),
    );
    expect(
      screen.getByText('Undangan untuk farida@example.test menunggu, berlaku sampai Sab, 7 Nov.'),
    ).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Kelola undangan' });
    expect(link.getAttribute('href')).toBe('/undang');
    expect(screen.queryByRole('link', { name: /Undang Farida ke Bersama/ })).toBeNull();
  });

  it('bukan pemilik: tanpa kartu ajakan dan tanpa email', () => {
    const { container } = render(
      view({ bersama: { ...S8_NONE, members: 1, isOwner: false, empty: false } }),
    );
    expect(screen.queryByText('Farida belum bergabung di Bersama.')).toBeNull();
    expect(screen.queryByRole('link', { name: /Undang|Kelola undangan/ })).toBeNull();
    expect(screen.getByText(INTRO)).toBeTruthy();
    expect(container.textContent).not.toContain('@');
  });
});

describe('BerandaReal Bersama kosong (S7-B2)', () => {
  const kosong = {
    hasOperasional: false,
    safe: { operasional: 0, billsUntilEom: 0, budgetWajibRemaining: 0, aman: 0, ...S9_SAFE },
  };

  it('State kosong menggantikan Aman; tanpa Tanpa pengeluaran dan Terbaru', () => {
    render(view({ ...kosong, bersama: { ...S8_NONE, members: 2, isOwner: true, empty: true } }));
    expect(screen.getByRole('heading', { name: 'Bersama belum punya dompet.' })).toBeTruthy();
    expect(
      screen.getByText('Buat dompet bersama dulu, lalu catat pengeluaran bersama di sini.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tambah dompet' }).getAttribute('href')).toBe(
      '/bersama/dompet?tambah=1',
    );
    expect(screen.queryByTestId('balance-card')).toBeNull();
    expect(screen.queryByRole('button', { name: /Tanpa pengeluaran/ })).toBeNull();
    expect(screen.queryByRole('region', { name: /Terbaru|Terakhir/ })).toBeNull();
    expect(screen.queryByText(/Rp\s?0/)).toBeNull();
    // Dua anggota: tanpa ajakan dan tanpa Aktivitas kosong; checklist tetap.
    expect(screen.queryByText('Farida belum bergabung di Bersama.')).toBeNull();
    expect(screen.getByRole('region', { name: 'Mulai dari sini' })).toBeTruthy();
  });

  it('solo + kosong: urutan kosong, ajakan, checklist, Aktivitas', () => {
    const { container } = render(
      view({
        ...kosong,
        bersama: { ...S8_NONE, members: 1, isOwner: true, empty: true, pendingInvite: null },
      }),
    );
    const order = [
      'Bersama belum punya dompet.',
      'Farida belum bergabung di Bersama.',
      'Mulai dari sini',
      'Aktivitas',
    ].map((t) => container.textContent.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('dompet tabungan saja dengan entri (tidak kosong): perilaku S6 (kartu Aman kosong B3)', () => {
    render(
      view({
        ...kosong,
        bersama: { ...S8_NONE, members: 2, isOwner: true, empty: false },
      }),
    );
    expect(screen.getByTestId('balance-card')).toBeTruthy();
    expect(screen.queryByText('Bersama belum punya dompet.')).toBeNull();
  });
});

describe('BerandaReal Bersama dua anggota dan Pribadi (tidak berubah)', () => {
  it('Bersama dua anggota: tanpa ajakan, tanpa Aktivitas, pengantar S6', () => {
    render(view({ bersama: { ...S8_NONE, members: 2, isOwner: true, empty: false } }));
    expect(screen.queryByText('Farida belum bergabung di Bersama.')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Aktivitas' })).toBeNull();
    expect(
      screen.getByText(
        'Pengeluaran yang kalian bagi. Kamu dan Farida sama-sama bisa mencatat dan mengubah di sini.',
      ),
    ).toBeTruthy();
  });

  it('Pribadi: tanpa ajakan/aktivitas Bersama', () => {
    render(view({ invite: true }, 'pribadi'));
    expect(screen.queryByText('Farida belum bergabung di Bersama.')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Aktivitas' })).toBeNull();
  });
});

// ===== S8 Task 6: kartu Aktivitas (S8-A1) dan Kontribusi (S8-K1) =====
function at<T>(list: T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`indeks ${String(i)} kosong`);
  return v;
}

const NOVANDA: MemberVM = { id: 'u-n', name: 'Novanda', initial: 'N', role: 'owner' };
const FARIDA: MemberVM = { id: 'u-f', name: 'Farida', initial: 'F', role: 'member' };

function act(i: number, over: Partial<ActivityItemVM> = {}): ActivityItemVM {
  const actor = i % 2 === 0 ? NOVANDA : FARIDA;
  return {
    key: `e${String(i)}:1`,
    entryId: `e${String(i)}`,
    actor,
    at: `2026-11-04T1${String(i)}:32:00+07:00`,
    text: `mencatat pengeluaran Item${String(i)}`,
    change: [],
    backdate: null,
    amount: 10_000 * (i + 1),
    beforeAmount: null,
    moved: false,
    href: `/bersama/transaksi/e${String(i)}` as ActivityItemVM['href'],
    ...over,
  };
}

const kontribusi = (over: Partial<ContributionVM> = {}): ContributionVM => ({
  period: { from: '2026-11-01', to: '2026-11-30', label: 'November' },
  rows: [
    { member: NOVANDA, setoran: 500_000, diambil: 0 },
    { member: FARIDA, setoran: 0, diambil: 120_000 },
  ],
  allZero: false,
  ...over,
});

const dua = (over: Partial<NonNullable<BerandaData['bersama']>> = {}) => ({
  members: 2,
  isOwner: true,
  empty: false,
  partner: { name: 'Farida', initial: 'F' },
  activity: [0, 1, 2, 3, 4].map((i) => act(i)),
  contributions: kontribusi(),
  ...over,
});

describe('BerandaReal Bersama dua anggota: Aktivitas (S8-A1)', () => {
  it('5 baris dari feed, tautan Semua ke /bersama/aktivitas, baris menaut ke Detail', () => {
    render(view({ bersama: dua() }));
    const kartu = screen.getByRole('region', { name: 'Aktivitas' });
    const rows = within(kartu).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    const semua = within(kartu).getByRole('link', { name: 'Semua aktivitas Bersama' });
    expect(semua.getAttribute('href')).toBe('/bersama/aktivitas');
    const first = within(at(rows, 0)).getByRole('link');
    expect(first.getAttribute('href')).toBe('/bersama/transaksi/e0');
    expect(first.textContent).toContain('Novanda');
    expect(first.textContent).toContain('mencatat pengeluaran Item0');
  });

  it('query tema ikut ke tautan Semua', () => {
    render(
      <BerandaReal
        ruang="bersama"
        today="2026-11-04"
        query="?theme=dark"
        data={{ ...base, bersama: dua() }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Semua aktivitas Bersama' }).getAttribute('href')).toBe(
      '/bersama/aktivitas?theme=dark',
    );
  });

  it('avatar: pemilik netral, anggota violet menurut peran', () => {
    render(view({ bersama: dua() }));
    const kartu = screen.getByRole('region', { name: 'Aktivitas' });
    const avatars = [...kartu.querySelectorAll('[data-initial]')];
    expect(avatars).toHaveLength(5);
    for (const a of avatars) {
      expect(a.className.includes('bg-bersama-tint')).toBe(a.textContent === 'F');
    }
  });

  it('kosong dua anggota: salinan dengan nama anggota lain, tanpa Semua', () => {
    render(view({ bersama: dua({ activity: [] }) }));
    const kartu = screen.getByRole('region', { name: 'Aktivitas' });
    expect(
      within(kartu).getByText(
        'Belum ada aktivitas. Yang kamu dan Farida catat di Bersama akan muncul di sini, terbaru di atas.',
      ),
    ).toBeTruthy();
    expect(within(kartu).queryByRole('link')).toBeNull();
  });

  it('kosong, dilihat Farida: nama Novanda', () => {
    render(view({ bersama: dua({ activity: [], partner: { name: 'Novanda', initial: 'N' } }) }));
    expect(screen.getByText(/Yang kamu dan Novanda catat di Bersama/)).toBeTruthy();
  });

  it('galat: baris galat dengan Coba lagi, kartu lain tetap tampil', () => {
    render(view({ bersama: dua({ activity: 'error' }) }));
    const kartu = screen.getByRole('region', { name: 'Aktivitas' });
    expect(within(kartu).getByText('Aktivitas belum bisa dimuat.')).toBeTruthy();
    expect(within(kartu).getByRole('link', { name: 'Coba lagi' }).getAttribute('href')).toBe(
      '/bersama/beranda',
    );
    expect(screen.getByRole('region', { name: 'Kontribusi November' })).toBeTruthy();
    expect(screen.getByTestId('balance-card')).toBeTruthy();
  });

  it('urutan grid utama: Kontribusi sebelum Aktivitas sebelum Terakhir', () => {
    const { container } = render(
      view({
        recent: [],
        bersama: dua(),
      }),
    );
    const t = container.textContent;
    const idx = ['Kontribusi November', 'Aktivitas', 'Terakhir'].map((x) => t.indexOf(x));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('cabang kosong dan tanpa operasional: Aktivitas ada, Kontribusi tidak', () => {
    const kosong = {
      hasOperasional: false,
      safe: { operasional: 0, billsUntilEom: 0, budgetWajibRemaining: 0, aman: 0, ...S9_SAFE },
    };
    const { unmount } = render(view({ ...kosong, bersama: dua({ empty: true, activity: [] }) }));
    expect(screen.getByRole('region', { name: 'Aktivitas' })).toBeTruthy();
    expect(screen.getByText(/Yang kamu dan Farida catat/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: /Kontribusi/ })).toBeNull();
    unmount();
    render(view({ ...kosong, bersama: dua({ empty: false }) }));
    expect(screen.getByRole('region', { name: 'Aktivitas' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: /Kontribusi/ })).toBeNull();
  });

  it('solo: tanpa Kontribusi, Aktivitas tetap kosong S7-B1; Pribadi: tanpa keduanya', () => {
    const { unmount } = render(
      view({
        bersama: {
          ...S8_NONE,
          members: 1,
          isOwner: true,
          empty: false,
          pendingInvite: null,
        },
      }),
    );
    expect(screen.queryByRole('region', { name: /Kontribusi/ })).toBeNull();
    expect(screen.getByText(AKTIVITAS)).toBeTruthy();
    unmount();
    render(view({}, 'pribadi'));
    expect(screen.queryByRole('region', { name: /Kontribusi|Aktivitas/ })).toBeNull();
  });

  it('privasi K1: markup kartu tanpa nama dompet atau id', () => {
    render(view({ bersama: dua(), recent: [] }));
    for (const name of ['Aktivitas', 'Kontribusi November']) {
      const html = screen.getByRole('region', { name }).innerHTML;
      expect(html).not.toMatch(/u-n|u-f|dompet/i);
      // Id entri hanya sebagai bagian tautan Detail.
      expect(html.replace(/href="[^"]*"/g, '')).not.toMatch(/\be\d(:1)?\b/);
    }
  });
});

describe('BerandaReal Bersama dua anggota: Kontribusi (S8-K1)', () => {
  it('satu blok per anggota (pemilik dulu); Diambil hanya bila > 0', () => {
    render(view({ bersama: dua() }));
    const kartu = screen.getByRole('region', { name: 'Kontribusi November' });
    expect(within(kartu).getByText('Setoran dan pengambilan antar ruang bulan ini.')).toBeTruthy();
    const blok = within(kartu).getAllByRole('listitem');
    expect(blok).toHaveLength(2);
    expect(blok[0]?.textContent).toContain('Novanda');
    expect(blok[0]?.textContent).toContain('Setor');
    expect(blok[0]?.textContent).not.toContain('Diambil');
    expect(blok[1]?.textContent).toContain('Farida');
    expect(blok[1]?.textContent).toContain('Diambil');
    // Farida tanpa setoran: Setor Rp 0 netral (muted).
    const setorF = within(at(blok, 1)).getByText('Setor').parentElement;
    expect(setorF?.querySelector('.text-text-muted')).not.toBeNull();
    expect(kartu.textContent).not.toMatch(/%|peringkat|lebih/i);
  });

  it('semua nol: EmptyLine tanpa baris per anggota', () => {
    render(
      view({
        bersama: dua({
          contributions: kontribusi({
            allZero: true,
            rows: [
              { member: NOVANDA, setoran: 0, diambil: 0 },
              { member: FARIDA, setoran: 0, diambil: 0 },
            ],
          }),
        }),
      }),
    );
    const kartu = screen.getByRole('region', { name: 'Kontribusi November' });
    expect(within(kartu).getByText('Belum ada setoran atau pengambilan bulan ini.')).toBeTruthy();
    expect(within(kartu).queryByRole('listitem')).toBeNull();
    expect(kartu.textContent).not.toContain('Farida');
  });

  it('galat: Kontribusi belum bisa dimuat + Coba lagi', () => {
    render(view({ bersama: dua({ contributions: 'error' }) }));
    const kartu = screen.getByRole('region', { name: 'Kontribusi' });
    expect(within(kartu).getByText('Kontribusi belum bisa dimuat.')).toBeTruthy();
    expect(within(kartu).getByRole('link', { name: 'Coba lagi' })).toBeTruthy();
  });
});

describe('BerandaReal sisi Farida (anggota, S8-O1/O2)', () => {
  it('Pribadi baru: 1 dari 3 selesai, Akun aman selesai, tanpa Undang Farida', () => {
    const { container } = render(
      view({ hasOperasional: false, hasExpense: false, invite: false }, 'pribadi'),
    );
    const cl = screen.getByRole('region', { name: 'Mulai dari sini' });
    expect(within(cl).getByText('1 dari 3 selesai')).toBeTruthy();
    expect(within(cl).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText(/Undang/)).toBeNull();
    expect(container.textContent).not.toContain('Farida');
  });

  it('Bersama berisi dompet Novanda: tanpa B1 dan ajakan, pengantar memakai nama Novanda', () => {
    const { container } = render(
      view({
        hasExpense: false,
        bersama: dua({ isOwner: false, partner: { name: 'Novanda', initial: 'N' }, activity: [] }),
      }),
    );
    expect(screen.queryByText(/belum bergabung/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Undang|Kelola undangan/ })).toBeNull();
    expect(screen.queryByText('Ruang untuk keuangan bersama.')).toBeNull();
    expect(
      screen.getByText(
        'Pengeluaran yang kalian bagi. Kamu dan Novanda sama-sama bisa mencatat dan mengubah di sini.',
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toContain('@');
    // Tidak ada "Farida" tetap di layar Farida, kecuali nama di data feed/Kontribusi.
    expect(screen.getByRole('region', { name: 'Mulai dari sini' }).textContent).not.toContain(
      'Farida',
    );
  });

  it('pemilik melihat nama Farida di pengantar', () => {
    render(view({ bersama: dua({ activity: [] }) }));
    expect(screen.getByText(/Kamu dan Farida sama-sama bisa mencatat/)).toBeTruthy();
  });
});
