import { todayWIB } from '@dompetku/domain';
import type { Route } from 'next';
import { notFound, unstable_rethrow } from 'next/navigation';
import { buildAktivitasHref, buildHref, keptQuery, REAL_KEPT_PARAMS } from '@/features/shell/hrefs';
import { isPrototype } from '@/server/env';
import { encodeCursor, loadAktivitas, parseCursor } from '@/server/ledger/bersama';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangContext } from '../_real/context';
import { AktivitasFailed, AktivitasReal } from '../_real/aktivitas';
import { AktivitasPage } from './view';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** `?sebelum=` ditambahkan ke query yang dibawa ('' atau '?a=b'). */
function withCursor(query: string, cursor: string): string {
  return `${query}${query === '' ? '?' : '&'}sebelum=${cursor}`;
}

/**
 * Prototipe: feed demo ringan di /bersama, tanpa auth/DB (ruang lain = 404). Nyata: gerbang di page (`ruangContext` =
 * `requireDataUser()` → `resolveSpace`), hanya ruang Bersama (Pribadi = 404), lalu `loadAktivitas`
 * lewat `withUser`. `?sebelum=` rusak = halaman pertama. Galat loader = layar gagal muat (bukan
 * galat rute); redirect/404 tetap dilempar. Halaman berdata: dirender per request,
 * `Cache-Control: no-store`.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ruang: string }>;
  searchParams: SearchParams;
}) {
  if (isPrototype()) {
    // Demo hanya di rute Bersama; Pribadi = 404 standar (frame S8-A3, R8).
    if ((await params).ruang !== 'bersama') notFound();
    return <AktivitasPage />;
  }
  const ctx = await ruangContext(params);
  if (ctx.ruang !== 'bersama') notFound();
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') sp.set(k, v);
  const query = keptQuery(sp, REAL_KEPT_PARAMS);
  const backHref = buildHref('bersama', 'beranda', query);
  const before = parseCursor(raw.sebelum);

  let data;
  try {
    data = await loadAktivitas(ctx, { before });
  } catch (e) {
    unstable_rethrow(e);
    console.error('[aktivitas] gagal memuat', errorTag(e));
    const retry = before === null ? query : withCursor(query, encodeCursor(before));
    return <AktivitasFailed backHref={backHref} retryHref={buildAktivitasHref(retry)} />;
  }
  // Tanpa baris tidak ada kursor lanjut yang berarti (hindari tautan mati).
  const olderHref: Route | null =
    data.next === null || data.items.length === 0
      ? null
      : buildAktivitasHref(withCursor(query, encodeCursor(data.next)));
  return (
    <AktivitasReal
      items={data.items}
      partnerName={data.partner?.name ?? null}
      today={todayWIB()}
      query={query}
      backHref={backHref}
      newestHref={before === null ? null : buildAktivitasHref(query)}
      olderHref={olderHref}
    />
  );
}
