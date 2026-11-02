import { isPrototype } from '@/server/env';
import { ruangContext } from '../_real/context';
import { RealPlaceholder } from '../_real/placeholder';
import { TransaksiPage } from './view';

/**
 * Prototipe: data demo, tanpa auth/DB. Nyata: gerbang di page (`ruangContext` =
 * `requireDataUser()` → `resolveSpace`). Data ledger disambung Task 15; sampai itu pengganti sementara tanpa data.
 */
export default async function Page({ params }: { params: Promise<{ ruang: string }> }) {
  if (isPrototype()) return <TransaksiPage />;
  const ctx = await ruangContext(params);
  return <RealPlaceholder ruang={ctx.ruang} title="Transaksi" />;
}
