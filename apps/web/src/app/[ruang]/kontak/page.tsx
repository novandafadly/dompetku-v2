import { notFound } from 'next/navigation';
import { isPrototype } from '@/server/env';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { errorTag } from '@/server/ledger/transaksi';
import { loadKontak } from '@/server/ledger/utang';
import { ruangContext } from '../_real/context';
import { KontakFailed, KontakReal } from '../_real/kontak';

/**
 * Menu → Kontak (S11-KT1): hanya mode nyata dan ruang Pribadi (prototipe tetap "Segera": 404;
 * `/bersama/kontak` = 404, kontak hanya di Pribadi). Gerbang di page (`ruangContext` =
 * `requireDataUser()` → `resolveSpace`), lalu kontak aktif lewat `withLedger`. Galat loader = layar
 * gagal muat; redirect/404 dari gerbang tetap dilempar. Halaman berdata: dirender per request.
 */
export default async function Page({ params }: { params: Promise<{ ruang: string }> }) {
  if (isPrototype()) notFound();
  const ctx = await ruangContext(params);
  if (ctx.kind !== 'personal') notFound();
  let contacts;
  try {
    contacts = await loadKontak(ctx);
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[kontak] gagal memuat', errorTag(e));
    return <KontakFailed ruang={ctx.ruang} />;
  }
  return <KontakReal ruang={ctx.ruang} contacts={contacts} />;
}
