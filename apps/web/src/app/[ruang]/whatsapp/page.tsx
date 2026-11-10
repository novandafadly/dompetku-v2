import { notFound, unstable_rethrow } from 'next/navigation';
import { isPrototype } from '@/server/env';
import { isSpaceNotFoundError } from '@/server/ledger/errors';
import { errorTag } from '@/server/ledger/transaksi';
import { loadWaLink } from '@/server/wa/link';
import { ruangContext } from '../_real/context';
import { WhatsappFailed, WhatsappReal } from '../_real/whatsapp';

/**
 * Menu → WhatsApp hanya ada di mode nyata (prototipe: 404, tanpa memuat apa pun dari fitur ini).
 * Gerbang di page (`ruangContext` = `requireDataUser()` → `resolveSpace`), lalu status tautan lewat
 * `withUser` (baris milik sendiri). Nomor sudah disamarkan sebelum sampai ke komponen. Galat loader
 * = layar gagal muat; redirect/404 dari gerbang tetap dilempar. Dirender per request, no-store.
 */
export default async function Page({ params }: { params: Promise<{ ruang: string }> }) {
  if (isPrototype()) notFound();
  const ctx = await ruangContext(params);
  let status;
  try {
    status = await loadWaLink(ctx);
  } catch (e) {
    unstable_rethrow(e);
    if (isSpaceNotFoundError(e)) notFound();
    console.error('[whatsapp] gagal memuat', errorTag(e));
    return <WhatsappFailed ruang={ctx.ruang} />;
  }
  return <WhatsappReal ruang={ctx.ruang} status={status} />;
}
