'use client';

import { addDays, todayWIB, type IsoDate } from '@dompetku/domain';
import type { Ruang } from '@dompetku/demo-data';
import type { Route } from 'next';
import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, Suspense, useContext, useState, type ReactNode } from 'react';
import {
  buildAccountHref,
  buildEntryHref,
  buildHref,
  buildSectionHref,
  isRuang,
  KEPT_PARAMS,
  keptQuery,
  REAL_KEPT_PARAMS,
  validMonth,
  withoutParam,
  type Tab,
} from './hrefs';

/**
 * Navigasi shell (ruang aktif, tanggal hari ini, alamat tab) tanpa bergantung pada store demo,
 * jadi mode nyata merender shell tanpa DemoProvider.
 */
export interface NavValue {
  ruang: Ruang;
  today: IsoDate;
  /** Query yang dibawa antar halaman ('' atau '?a=b'). */
  query: string;
  /** Bulan terpilih di Transaksi ('YYYY-MM'), dari `?bulan=`. */
  month: string;
  /** Alamat tab di ruang tertentu. */
  href: (ruang: Ruang, tab: Tab) => Route;
  entryHref: (ruang: Ruang, id: string) => Route;
  accountHref: (ruang: Ruang, id: string) => Route;
  monthHref: (ruang: Ruang, month: string) => Route;
  sampahHref: (ruang: Ruang) => Route;
  kategoriHref: (ruang: Ruang) => Route;
  /** Hanya DemoProvider yang perlu: membuang satu parameter dari query tersimpan (mis. `state`). */
  dropParam: (key: string) => void;
}

const NavContext = createContext<NavValue | null>(null);

/** `?today=` hanya berlaku di prototipe; nilai ngawur jatuh ke `fallback`. */
function validToday(raw: string | null, fallback: IsoDate): IsoDate {
  if (raw === null) return fallback;
  try {
    addDays(raw, 0);
    return raw;
  } catch (e) {
    if (e instanceof RangeError) return fallback;
    throw e;
  }
}

function NavProviderInner({
  today: serverToday,
  prototype,
  children,
}: {
  today: IsoDate;
  prototype: boolean;
  children: ReactNode;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  // Prototipe: tanggal dan query dibaca sekali saat mount, navigasi berikutnya tidak mengubahnya.
  // Tanpa `?today=` tanggal mengikuti jam klien (WIB), seperti sebelum shell lepas dari store demo.
  const [bootToday] = useState(() =>
    validToday(params.get('today'), prototype ? todayWIB() : serverToday),
  );
  const [query, setQuery] = useState(() =>
    keptQuery(params, prototype ? KEPT_PARAMS : REAL_KEPT_PARAMS),
  );
  const today = prototype ? bootToday : serverToday;
  const bulan = params.get('bulan');
  const segment = pathname.split('/')[1];
  const ruang: Ruang = isRuang(segment) ? segment : 'pribadi';
  // Segmen sungguhan, bukan tab yang tampak aktif: Sampah menandai Transaksi tetapi tidak membawa bulan.
  const inTransaksi = pathname.split('/')[2] === 'transaksi';

  const month = validMonth(bulan, today);
  // Bulan hanya dibawa selama masih di dalam Transaksi; tab lain tidak mewarisinya.
  const keep = inTransaksi ? { value: month, today } : undefined;
  const value: NavValue = {
    ruang,
    today,
    query,
    month,
    href: (r, tab) => buildHref(r, tab, query, keep),
    entryHref: (r, id) => buildEntryHref(r, id, query, keep),
    accountHref: (r, id) => buildAccountHref(r, id, query),
    monthHref: (r, m) => buildHref(r, 'transaksi', query, { value: m, today }),
    sampahHref: (r) => buildSectionHref(r, 'sampah', query),
    kategoriHref: (r) => buildSectionHref(r, 'kategori', query),
    dropParam: (key) => {
      setQuery((q) => withoutParam(q, key));
    },
  };

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

/**
 * `today` dari server (todayWIB). Di prototipe tanggal diambil dari `?today=`, lalu jam klien; `today` server tidak dipakai.
 * `prototype` ditentukan server: klien tidak bisa membaca env runtime.
 */
export function NavProvider({
  today,
  prototype = false,
  children,
}: {
  today: IsoDate;
  prototype?: boolean;
  children: ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <NavProviderInner today={today} prototype={prototype}>
        {children}
      </NavProviderInner>
    </Suspense>
  );
}

export function useNav(): NavValue {
  const ctx = useContext(NavContext);
  if (ctx === null) throw new Error('useNav harus dipakai di dalam <NavProvider>');
  return ctx;
}
