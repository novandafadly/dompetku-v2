import { todayWIB } from '@dompetku/domain';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/pribadi/beranda';
let search = '';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

import { NavProvider, useNav, type NavValue } from './nav-provider';

function capture(prototype: boolean, today = '2026-10-31'): NavValue {
  const seen: { value?: NavValue } = {};
  function Probe() {
    seen.value = useNav();
    return null;
  }
  render(
    <NavProvider today={today} prototype={prototype}>
      <Probe />
    </NavProvider>,
  );
  if (!seen.value) throw new Error('NavProvider tidak merender anaknya');
  return seen.value;
}

beforeEach(() => {
  pathname = '/pribadi/beranda';
  search = '';
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('NavProvider, mode prototipe', () => {
  it('href mempertahankan seed, today, keypad (dan state, theme) dan membuang sisanya', () => {
    search = '?seed=empty&today=2026-10-15&keypad=app&state=error&theme=light&junk=1';
    const nav = capture(true);
    expect(nav.href('bersama', 'transaksi')).toBe(
      '/bersama/transaksi?seed=empty&today=2026-10-15&theme=light&keypad=app&state=error',
    );
    expect(nav.today).toBe('2026-10-15');
    expect(nav.query).not.toContain('junk');
  });

  it('today dari alamat dipakai; yang tidak valid jatuh ke jam klien', () => {
    search = '?today=2026-10-15';
    expect(capture(true, '2026-11-01').today).toBe('2026-10-15');
    search = '?today=bukan-tanggal';
    expect(capture(true, '2026-11-01').today).toBe(todayWIB());
  });
});

describe('NavProvider, jam prototipe', () => {
  it('tanpa ?today= tanggal mengikuti jam klien (WIB), bukan today server', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // 17.30 UTC = 00.30 WIB tanggal berikutnya.
      vi.setSystemTime(new Date('2026-10-30T17:30:00Z'));
      expect(capture(true, '2026-11-01').today).toBe('2026-10-31');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('NavProvider, mode nyata', () => {
  it('query hanya theme: seed, today, keypad, state tidak terbawa', () => {
    search = '?seed=empty&today=2026-10-15&keypad=app&state=error&theme=dark';
    const nav = capture(false);
    expect(nav.href('bersama', 'dompet')).toBe('/bersama/dompet?theme=dark');
    expect(nav.today).toBe('2026-10-31');
  });

  it('today mengikuti prop server', () => {
    search = '?today=2026-10-15';
    expect(capture(false, '2026-11-01').today).toBe('2026-11-01');
  });
});

describe('NavProvider, alamat', () => {
  it('ruang dari segmen alamat; selain itu pribadi', () => {
    pathname = '/bersama/dompet';
    expect(capture(false).ruang).toBe('bersama');
    pathname = '/masuk';
    expect(capture(false).ruang).toBe('pribadi');
  });

  it('entryHref, accountHref, sampahHref, kategoriHref', () => {
    const nav = capture(false);
    expect(nav.entryHref('pribadi', 'a/b')).toBe('/pribadi/transaksi/a%2Fb');
    expect(nav.accountHref('bersama', 'x1')).toBe('/bersama/dompet/x1');
    expect(nav.sampahHref('bersama')).toBe('/bersama/sampah');
    expect(nav.kategoriHref('pribadi')).toBe('/pribadi/kategori');
  });

  it('bulan terbawa hanya di dalam Transaksi', () => {
    search = '?bulan=2026-09';
    pathname = '/pribadi/transaksi';
    const inTx = capture(false);
    expect(inTx.month).toBe('2026-09');
    expect(inTx.href('pribadi', 'transaksi')).toBe('/pribadi/transaksi?bulan=2026-09');
    expect(inTx.href('pribadi', 'dompet')).toBe('/pribadi/dompet');
    expect(inTx.monthHref('pribadi', '2026-08')).toBe('/pribadi/transaksi?bulan=2026-08');
    expect(inTx.monthHref('pribadi', '2026-10')).toBe('/pribadi/transaksi');
    pathname = '/pribadi/dompet';
    expect(capture(false).href('pribadi', 'transaksi')).toBe('/pribadi/transaksi');
  });

  it('bulan tidak valid atau di masa depan jatuh ke bulan ini', () => {
    search = '?bulan=2027-01';
    expect(capture(false).month).toBe('2026-10');
    search = '?bulan=ngawur';
    expect(capture(false).month).toBe('2026-10');
  });
});

describe('useNav', () => {
  it('melempar di luar NavProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Probe() {
      useNav();
      return null;
    }
    expect(() => render(<Probe />)).toThrow(/NavProvider/);
  });
});
