import { notFound, unstable_rethrow } from 'next/navigation';
import { isPrototype } from '@/server/env';
import { isSpaceNotFoundError, toLedgerError } from '@/server/ledger/errors';
import { exportLaporanCsv, exportLimiter } from '@/server/ledger/ekspor';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangContext } from '../../_real/context';

/**
 * Unduhan CSV periode Laporan (S10-EX1, Task 8): `GET /[ruang]/laporan/ekspor?periode=YYYY-MM&basis=`.
 * Mode nyata saja (prototipe 404). Gerbang sama dengan page (`ruangContext`: sesi penuh atau redirect,
 * ruang dari URL, bukan anggota = 404), lalu batas laju per user (429), lalu `exportLaporanCsv`.
 * Galat jaringan/server: teks polos tanpa isi data (dilog hanya tag galat). Selalu `no-store`.
 */
export const dynamic = 'force-dynamic';

const text = (body: string, status: number, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ruang: string }> },
): Promise<Response> {
  if (isPrototype()) notFound();
  const ctx = await ruangContext(params);
  if (!exportLimiter.allow(ctx.userId)) {
    return text('rate_limited', 429, { 'Retry-After': '3600' });
  }
  const sp = new URL(req.url).searchParams;
  try {
    const out = await exportLaporanCsv(ctx, {
      label: sp.getAll('periode').length === 1 ? (sp.get('periode') ?? undefined) : undefined,
      basis: sp.getAll('basis').length === 1 ? (sp.get('basis') ?? undefined) : undefined,
    });
    return new Response(out.csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${out.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    unstable_rethrow(e);
    if (isSpaceNotFoundError(e)) notFound();
    const err = toLedgerError(e);
    if (err?.code === 'export_too_large') return text('export_too_large', 422);
    console.error('[ekspor] gagal', errorTag(e));
    return text('error', 500);
  }
}
