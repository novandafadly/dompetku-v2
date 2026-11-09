import { todayWIB } from '@dompetku/domain';
import { keptQuery, REAL_KEPT_PARAMS } from '@/features/shell/hrefs';
import { isPrototype } from '@/server/env';
import { loadBeranda } from '@/server/ledger/beranda';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { BerandaReal } from '../_real/beranda';
import { ruangAccounts, ruangContext } from '../_real/context';
import { BerandaPage } from './view';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Prototipe: data demo, tanpa auth/DB. Nyata: gerbang di page, bukan hanya di layout (request RSC
 * bisa merender segmen page tanpa layout): `ruangContext` = `requireDataUser()` → `resolveSpace`,
 * lalu loader ruang ini lewat `withUser`.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ruang: string }>;
  searchParams: SearchParams;
}) {
  if (isPrototype()) return <BerandaPage />;
  const ctx = await ruangContext(params);
  let data;
  try {
    data = await loadBeranda(ctx, { accounts: ruangAccounts(ctx) });
  } catch (e) {
    rethrowOrNotFound(e);
    throw e;
  }
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') sp.set(k, v);
  return (
    <BerandaReal
      ruang={ctx.ruang}
      today={todayWIB()}
      query={keptQuery(sp, REAL_KEPT_PARAMS)}
      data={data}
    />
  );
}
