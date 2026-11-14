import { todayWIB } from '@dompetku/domain';
import { keptQuery, REAL_KEPT_PARAMS } from '@/features/shell/hrefs';
import { isPrototype } from '@/server/env';
import { loadDompetDaftar } from '@/server/ledger/dompet';
import { loadTrading } from '@/server/ledger/trading';
import { rethrowOrNotFound } from '@/server/ledger/page-guard';
import { errorTag } from '@/server/ledger/transaksi';
import { ruangAccounts, ruangContext } from '../_real/context';
import { DompetFailed, DompetReal } from '../_real/dompet';
import { DompetPage } from './view';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Prototipe: data demo, tanpa auth/DB. Nyata: gerbang di page (`ruangContext` =
 * `requireDataUser()` → `resolveSpace`), lalu dompet ruang ini (saldo `account_balances`) lewat
 * `withUser`, ditambah dompet terarsip dan, hanya di Pribadi, talangan yang menunggu reimburse. Galat loader = layar gagal muat (bukan galat rute); redirect/404 dari gerbang tetap
 * dilempar. `?tambah=1` (dari sheet Catat di ruang tanpa dompet) dibaca pulau klien yang membuka sheet.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ruang: string }>;
  searchParams: SearchParams;
}) {
  if (isPrototype()) return <DompetPage />;
  const ctx = await ruangContext(params);
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') sp.set(k, v);

  let accounts;
  let extra;
  try {
    // Berurutan: puncak satu koneksi pool dari page ini (pool max 5).
    accounts = await ruangAccounts(ctx);
    extra = await loadDompetDaftar(ctx, ctx.kind);
  } catch (e) {
    rethrowOrNotFound(e);
    console.error('[dompet] gagal memuat', errorTag(e));
    return <DompetFailed />;
  }
  // S12: kartu Modal trading hanya di Pribadi dan hanya bila ada dompet trading aktif; galatnya
  // mematikan kartu itu saja (daftar dompet tetap tampil).
  let trading;
  if (ctx.kind === 'personal' && accounts.some((a) => a.pocket === 'trading' && !a.archived)) {
    try {
      trading = await loadTrading(ctx);
    } catch (e) {
      rethrowOrNotFound(e);
      console.error('[dompet] modal trading gagal memuat', errorTag(e));
      trading = 'error' as const;
    }
  }
  return (
    <DompetReal
      ruang={ctx.ruang}
      query={keptQuery(sp, REAL_KEPT_PARAMS)}
      today={todayWIB()}
      accounts={accounts}
      reimbursables={extra.reimbursables}
      archived={extra.archived}
      trading={trading ?? null}
    />
  );
}
