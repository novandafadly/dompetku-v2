import { notFound } from 'next/navigation';
import { isPrototype } from '@/server/env';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangCategories, ruangContext } from '../_real/context';
import { KategoriFailed, KategoriReal } from '../_real/kategori';

/**
 * Menu → Kategori hanya ada di mode nyata (prototipe tetap "Segera": 404). Gerbang di page
 * (`ruangContext` = `requireDataUser()` → `resolveSpace`), lalu kategori aktif ruang ini lewat
 * `withUser`. Galat loader = layar gagal muat (bukan galat rute); redirect/404 dari gerbang tetap
 * dilempar. Halaman berdata: dirender per request, `Cache-Control: no-store`.
 */
export default async function Page({ params }: { params: Promise<{ ruang: string }> }) {
  if (isPrototype()) notFound();
  const ctx = await ruangContext(params);
  let categories;
  try {
    categories = await ruangCategories(ctx);
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[kategori] gagal memuat', errorTag(e));
    return <KategoriFailed ruang={ctx.ruang} />;
  }
  return <KategoriReal ruang={ctx.ruang} categories={categories} />;
}
