import { notFound } from 'next/navigation';
import { keptQuery, REAL_KEPT_PARAMS } from '@/features/shell/hrefs';
import { isPrototype } from '@/server/env';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { errorTag } from '@/server/ledger/transaksi';
import { loadDebtDetail, loadKontak } from '@/server/ledger/utang';
import { ruangAccounts, ruangContext } from '../../../_real/context';
import { UtangDetailFailed } from '../../../_real/utang';
import { UtangDetailHosted } from '../../../_real/utang-section';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Detail utang (S11-DT1): hanya mode nyata dan ruang Pribadi (prototipe dan Bersama = 404, B10).
 * Gerbang di page (`ruangContext`), lalu detail, kontak aktif, dan dompet ruang ini. Utang yang
 * tidak ada, milik ruang lain, atau sudah dihapus = 404 (pemulihan lewat grup `Utang dihapus`).
 * Galat loader = layar gagal muat; redirect/404 dari gerbang tetap dilempar.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ruang: string; id: string }>;
  searchParams: SearchParams;
}) {
  if (isPrototype()) notFound();
  const ctx = await ruangContext(params);
  if (ctx.kind !== 'personal') notFound();
  const { id } = await params;
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') sp.set(k, v);
  const query = keptQuery(sp, REAL_KEPT_PARAMS);

  let loaded;
  try {
    const [detail, contacts, accounts] = await Promise.all([
      loadDebtDetail(ctx, id),
      loadKontak(ctx),
      ruangAccounts(ctx),
    ]);
    loaded = { detail, contacts, accounts };
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[utang] detail gagal memuat', errorTag(e));
    return <UtangDetailFailed ruang={ctx.ruang} query={query} />;
  }
  if (loaded.detail === null) notFound();
  return (
    <UtangDetailHosted
      ruang={ctx.ruang}
      query={query}
      detail={loaded.detail}
      contacts={loaded.contacts}
      accounts={loaded.accounts}
    />
  );
}
