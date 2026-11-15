import { todayWIB } from '@dompetku/domain';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { buildHref, keptQuery, REAL_KEPT_PARAMS } from '@/features/shell/hrefs';
import { isPrototype } from '@/server/env';
import { loadDompetRiwayat } from '@/server/ledger/dompet';
import { loadTrading } from '@/server/ledger/trading';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { ACCOUNT_HISTORY_MAX } from '@/server/ledger/read';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangAccounts, ruangContext } from '../../_real/context';
import { DompetDetailFailed, DompetDetailReal, HISTORY_PAGE } from '../../_real/dompet-detail';
import { DompetRiwayatPage } from './view';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** `?tampil=` = jumlah entri yang ditampilkan; kosong atau tak sah = satu halaman. */
function shownCount(raw: string | string[] | undefined): number {
  const n = typeof raw === 'string' && /^\d{1,5}$/.test(raw) ? Number(raw) : HISTORY_PAGE;
  return Math.min(Math.max(n, HISTORY_PAGE), ACCOUNT_HISTORY_MAX);
}

/**
 * Prototipe: data demo, tanpa auth/DB. Nyata: gerbang di page (`ruangContext` =
 * `requireDataUser()` → `resolveSpace`), lalu riwayat dompet ruang ini lewat `withUser`. Dompet
 * yang bukan milik ruang ini (atau bukan uuid) = 404, sama dengan tidak ada. Galat loader = layar
 * gagal muat; redirect/404 dari gerbang tetap dilempar.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ruang: string; id: string }>;
  searchParams: SearchParams;
}) {
  if (isPrototype()) return <DompetRiwayatPage />;
  const ctx = await ruangContext(params);
  const { id } = await params;
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') sp.set(k, v);
  const query = keptQuery(sp, REAL_KEPT_PARAMS);
  const dompetHref = buildHref(ctx.ruang, 'dompet', query);
  const shown = shownCount(raw.tampil);

  let data;
  let accounts;
  try {
    accounts = await ruangAccounts(ctx);
    data = await loadDompetRiwayat(ctx, id, shown, accounts);
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[dompet] riwayat gagal memuat', errorTag(e));
    return <DompetDetailFailed dompetHref={dompetHref} />;
  }
  if (data === null) notFound();
  // S12: kartu Modal hanya untuk dompet trading aktif; galatnya mematikan kartu itu saja.
  let trading;
  if (data.account.pocket === 'trading' && !data.account.archived) {
    try {
      const overview = await loadTrading(ctx);
      trading = overview.accounts.find((a) => a.id === id) ?? null;
    } catch (e) {
      rethrowOrNotFound(e);
      console.error('[dompet] modal trading gagal memuat', errorTag(e));
      trading = 'error' as const;
    }
  }
  const moreQuery = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  moreQuery.set('tampil', String(shown + HISTORY_PAGE));
  return (
    <DompetDetailReal
      ruang={ctx.ruang}
      today={todayWIB()}
      query={query}
      dompetHref={dompetHref}
      moreHref={
        data.hasMore
          ? (`/${ctx.ruang}/dompet/${data.account.id}?${moreQuery.toString()}` as Route)
          : null
      }
      data={data}
      accounts={accounts}
      trading={trading ?? null}
    />
  );
}
