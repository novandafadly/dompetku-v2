import { createSeed } from '@dompetku/demo-data';

/** Rute M0a yang diperiksa a11y, scroll 320, dan screenshot. */
export const TODAY = '2026-10-17';
const full = createSeed({ today: TODAY, variant: 'full' });

function entryId(ruang: 'pribadi' | 'bersama'): string {
  const entry = full.entries.find(
    (e) => e.ruang === ruang && e.kind === 'expense' && e.voidedAt === undefined,
  );
  if (!entry) throw new Error(`seed tanpa pengeluaran ${ruang}`);
  return entry.id;
}

function accountId(ruang: 'pribadi' | 'bersama'): string {
  const account = full.accounts.find((a) => a.ruang === ruang);
  if (!account) throw new Error(`seed tanpa dompet ${ruang}`);
  return account.id;
}

export interface AppRoute {
  /** Nama berkas screenshot, mis. `pribadi-beranda`. */
  name: string;
  path: string;
  /** Rute utama: ikut dipotret untuk docs/screenshots/m0a. */
  screenshot: boolean;
  /** Halaman panjang dipotret sebatas viewport agar ukuran repo terkendali. */
  fullPage: boolean;
}

const SCREENSHOT_ROUTES = new Set([
  'pribadi-beranda',
  'pribadi-beranda-kosong',
  'bersama-beranda',
  'pribadi-transaksi',
  'bersama-transaksi',
  'pribadi-transaksi-detail',
  'pribadi-dompet',
  'pribadi-dompet-detail',
  'masuk',
  'terima-undangan',
]);

/** Daftar panjang: screenshot sebatas viewport. */
const LONG_PAGE = /\/(transaksi|transaksi\/[^/]+|dompet\/[^/]+)$/;

function route(name: string, path: string, seed: 'full' | 'empty' = 'full'): AppRoute {
  return {
    name,
    path: `${path}?seed=${seed}&today=${TODAY}`,
    screenshot: SCREENSHOT_ROUTES.has(name),
    fullPage: !LONG_PAGE.test(path),
  };
}

export const ROUTES: AppRoute[] = [
  ...(['pribadi', 'bersama'] as const).flatMap((r) => [
    route(`${r}-beranda`, `/${r}/beranda`),
    route(`${r}-beranda-kosong`, `/${r}/beranda`, 'empty'),
    route(`${r}-transaksi`, `/${r}/transaksi`),
    route(`${r}-transaksi-detail`, `/${r}/transaksi/${entryId(r)}`),
    route(`${r}-dompet`, `/${r}/dompet`),
    route(`${r}-dompet-detail`, `/${r}/dompet/${accountId(r)}`),
    route(`${r}-rencana`, `/${r}/rencana`),
  ]),
  route('masuk', '/masuk'),
  route('amankan', '/amankan'),
  route('undang', '/undang'),
  route('terima-undangan', '/terima-undangan'),
  route('dev-ui', '/dev/ui'),
];
