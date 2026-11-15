import { todayWIB } from '@dompetku/domain';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { buildHref, keptQuery, REAL_KEPT_PARAMS } from '@/features/shell/hrefs';
import { buildPatunganHref } from '@/features/shell/patungan-hrefs';
import { isPrototype } from '@/server/env';
import { encodeSplitCursor, loadPatungan, parseSplitCursor } from '@/server/ledger/patungan';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangContext } from '../_real/context';
import { PatunganFailed, PatunganReal } from '../_real/patungan';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `?sebelum=` ditambahkan ke query yang dibawa ('' atau '?a=b'). */
function withCursor(query: string, cursor: string): string {
  return `${query}${query === '' ? '?' : '&'}sebelum=${cursor}`;
}

/**
 * Patungan Bersama (S12-PT2): hanya mode nyata dan ruang Bersama (prototipe dan `/pribadi/patungan`
 * = 404). Gerbang di page (`ruangContext` = `requireDataUser()` → `resolveSpace`), lalu saldo dan
 * riwayat lewat `withLedger`. `?sebelum=` rusak = halaman pertama; `?lunasi=1` / `?terima=id`
 * (tautan kartu Beranda) membuka sheetnya. Galat loader = layar gagal muat; redirect/404 dari
 * gerbang tetap dilempar. Halaman berdata: dirender per request.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ruang: string }>;
  searchParams: SearchParams;
}) {
  if (isPrototype()) notFound();
  const ctx = await ruangContext(params);
  if (ctx.kind !== 'shared') notFound();
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') sp.set(k, v);
  const query = keptQuery(sp, REAL_KEPT_PARAMS);
  const backHref = buildHref('bersama', 'beranda', query);
  const before = parseSplitCursor(raw.sebelum);

  let data;
  try {
    data = await loadPatungan(ctx, { before });
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[patungan] gagal memuat', errorTag(e));
    return <PatunganFailed backHref={backHref} />;
  }
  const olderHref: Route | null =
    data.next === null || data.history.length + data.deleted.length === 0
      ? null
      : (`/bersama/patungan${withCursor(query, encodeSplitCursor(data.next))}` as Route);
  const terima = typeof raw.terima === 'string' && UUID.test(raw.terima) ? raw.terima : null;
  return (
    <PatunganReal
      data={data}
      query={query}
      today={todayWIB()}
      backHref={backHref}
      olderHref={olderHref}
      newestHref={before === null ? null : buildPatunganHref(query)}
      initial={{ lunasi: raw.lunasi === '1', terima }}
    />
  );
}
