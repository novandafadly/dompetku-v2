import { NextResponse, type NextRequest } from 'next/server';
import { ENFORCED_BASELINE_CSP, contentSecurityPolicy, createNonce } from '@/lib/security-headers';
import { TABS, isRuang } from '@/features/shell/hrefs';

/**
 * `/<bukan-ruang>/<tab>`: halaman dinamis (wajib untuk nonce) melempar notFound di dalam
 * Suspense DemoProvider sehingga status stream 200. Ditulis ulang ke jalur tanpa rute agar 404.
 */
function unknownRuang(pathname: string): boolean {
  const [, first, second] = pathname.split('/');
  return second !== undefined && !isRuang(first) && (TABS as readonly string[]).includes(second);
}

/**
 * CSP bernonce per request (TRD §3.4). Next membaca nonce dari header CSP request dan
 * memasangnya di skrip framework; layout membaca `x-nonce` untuk skrip tema.
 * `CSP_REPORT_ONLY=1` (env runtime) = minggu report-only M0b; baseline tetap ditegakkan.
 */
export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
  const reportOnly = process.env.CSP_REPORT_ONLY === '1';

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = unknownRuang(request.nextUrl.pathname)
    ? NextResponse.rewrite(new URL('/_ruang-tidak-dikenal', request.url), {
        request: { headers: requestHeaders },
      })
    : NextResponse.next({ request: { headers: requestHeaders } });
  if (reportOnly) {
    response.headers.set('Content-Security-Policy-Report-Only', csp);
    response.headers.set('Content-Security-Policy', ENFORCED_BASELINE_CSP);
  } else {
    response.headers.set('Content-Security-Policy', csp);
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Aset statis, health, ikon, dan manifest tidak butuh nonce.
      source:
        '/((?!_next/static|_next/image|api/health|favicon.ico|icon.svg|apple-icon.png|icons/|manifest.webmanifest).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
