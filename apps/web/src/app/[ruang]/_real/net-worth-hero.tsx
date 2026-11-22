import { daysInclusive, shortDateLabel, type IsoDate } from '@dompetku/domain';
import { ClockIcon } from '@/components/ui/icons/clock';
import { InfoIcon } from '@/components/ui/icons/info';
import { MoneyText } from '@/components/ui/money-text';
import { SpaceTag } from '@/components/ui/space-tag';
import { heroCard } from '@/components/ui/styles';
import { CardError } from '@/features/bersama/card-error';
import { NW_COPY as C } from '@/features/aset/copy';
import type { NetWorthVM, Ruang } from '@/features/ledger/types';

/** "14 Nov 2026": tanggal harga dengan tahun (bingkai NW1). */
const withYear = (d: IsoDate): string => `${shortDateLabel(d)} ${d.slice(0, 4)}`;

/**
 * Hero `Kekayaan bersih` mode nyata (S14-NW1; Server Component). Semua angka dari `api.net_worth`
 * (satu fungsi SQL untuk Dompet dan snapshot): komponen dan total tidak dijumlah di sini, hanya
 * dipilih mana yang tampil (komponen 0 tidak dirender; rincian tidak tampil bila hanya Kas).
 * Perubahan 30 hari tidak dihitung (tanpa selisih, panah, atau warna): hanya nominal lampaunya.
 */
export function NetWorthHero({
  ruang,
  today,
  netWorth,
  retryHref,
}: {
  ruang: Ruang;
  today: IsoDate;
  /** `error` = loader gagal: kartu tetap ada dengan galatnya, daftar dompet tetap tampil. */
  netWorth: NetWorthVM | 'error';
  retryHref: string;
}) {
  const n = netWorth === 'error' ? null : netWorth;
  const parts =
    n === null
      ? []
      : [
          { key: 'kas', label: C.kas, value: n.kas },
          { key: 'aset', label: C.aset, value: n.aset },
          { key: 'saham', label: C.saham, value: n.sahamPasar },
          { key: 'piutang', label: C.piutang, value: n.piutang },
          // Utang dikurangkan: ditampilkan minus.
          { key: 'utang', label: C.utang, value: -n.utang },
        ].filter((p) => p.value !== 0);
  // Rincian hanya bila ada komponen selain Kas (subjudul sudah menjelaskan Kas).
  const showParts = parts.some((p) => p.key !== 'kas');
  const stocks = n !== null && (n.sahamPasar !== 0 || n.sahamTanpaHarga > 0);
  const sub =
    ruang === 'pribadi'
      ? C.subPersonal
      : n !== null && n.aset !== 0
        ? C.subShared
        : C.subSharedCash;
  return (
    <section
      aria-labelledby="kekayaan"
      className={`flex flex-col gap-2 p-4 laptop:p-6 ${heroCard}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id="kekayaan" className="text-label font-semibold text-text-soft">
          {C.title}
        </h2>
        <SpaceTag space={ruang} />
      </div>
      {n === null ? (
        <CardError message={C.loadFailed} retryHref={retryHref} />
      ) : (
        <>
          <p data-testid="net-worth">
            <MoneyText value={n.total} size="amount" className="laptop:text-display-lg" />
          </p>
          {n.monthAgoTotal === null || n.monthAgoOn === null ? null : (
            <p data-testid="net-worth-month-ago" className="text-meta font-medium text-text-soft">
              {daysInclusive(n.monthAgoOn, today) - 1 === 30
                ? '30 hari lalu '
                : `${shortDateLabel(n.monthAgoOn)} `}
              <MoneyText value={n.monthAgoTotal} size="inherit" />
            </p>
          )}
          {showParts ? (
            <dl
              data-testid="net-worth-parts"
              className="flex flex-col gap-1.5 laptop:flex-row laptop:flex-wrap laptop:gap-x-8"
            >
              {parts.map((p) => (
                <div
                  key={p.key}
                  className="flex items-baseline justify-between gap-3 laptop:flex-col laptop:items-start laptop:justify-start laptop:gap-0.5"
                >
                  <dt className="text-meta font-medium text-text-soft">{p.label}</dt>
                  <dd className="text-meta font-bold whitespace-nowrap text-text">
                    <MoneyText value={p.value} size="inherit" />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {stocks ? (
            <p className="flex items-start gap-1.5 text-caption font-medium text-text-muted">
              {n.sahamTanpaHarga > 0 || n.priceAsOf === null ? (
                <>
                  <InfoIcon size={14} className="mt-px shrink-0" />
                  <span className="min-w-0 text-pretty">{C.missingPrice}</span>
                </>
              ) : (
                <>
                  <ClockIcon size={14} className="mt-px shrink-0" />
                  <span>{C.priceAsOf(withYear(n.priceAsOf))}</span>
                </>
              )}
            </p>
          ) : null}
          <p className="text-meta font-medium text-text-soft">{sub}</p>
        </>
      )}
    </section>
  );
}
