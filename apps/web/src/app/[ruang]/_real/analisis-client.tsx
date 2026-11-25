'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { ChartLineUpIcon } from '@/components/ui/icons/chart-line-up';
import { InfoIcon } from '@/components/ui/icons/info';
import { LightningIcon } from '@/components/ui/icons/lightning';
import { MoneyText } from '@/components/ui/money-text';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { card, focusRing, heroCard, rowDivider } from '@/components/ui/styles';
import type {
  AiAnalysisOutputVM,
  AnalysisOverviewVM,
  AnalysisPeriodChoice,
  RunAnalysisErrorCode,
} from '@/features/analisis/types';
import type { Ruang } from '@/features/ledger/types';
import { buildSectionHref, RUANG_LABEL } from '@/features/shell/hrefs';
import { runAnalysisAction } from '../_actions/analisis';
import { RetryIsland } from './transaksi-islands';

const ERROR_COPY: Record<RunAnalysisErrorCode, string> = {
  no_data: 'Belum ada transaksi di periode ini untuk dianalisis.',
  not_configured: 'Analisis AI belum aktif di server ini. Ringkasan angka di atas tetap tersedia.',
  quota_exceeded:
    'Kuota analisis AI hari ini sudah terpakai penuh. Kuota terisi lagi besok pukul 00.00 WIB.',
  network: 'Layanan AI sedang sibuk atau koneksi terputus. Coba lagi sebentar lagi.',
};

const PROVIDER_LABEL: Record<AiAnalysisOutputVM['provider'], string> = {
  gemini: 'Gemini',
  anthropic: 'Claude',
};

function periodHref(ruang: Ruang, choice: AnalysisPeriodChoice): Route {
  return (
    choice === 'previous' ? `/${ruang}/analisis?periode=lalu` : `/${ruang}/analisis`
  ) as Route;
}

/**
 * Halaman Analisis AI mode nyata (`/[ruang]/analisis`, S18-AN1..AN3).
 * Menampilkan ringkasan angka SQL ruang ini dulu (selalu hidup walau AI mati atau kuota habis),
 * lalu tombol eksplisit "Buat analisis AI" yang hanya mengirim angka agregat (B13).
 */
export function AnalisisClient({
  ruang,
  query,
  data,
}: {
  ruang: Ruang;
  query: string;
  data: AnalysisOverviewVM;
}) {
  const [quota, setQuota] = useState(data.quota);
  const [analysis, setAnalysis] = useState<AiAnalysisOutputVM | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canRun = data.hasData && data.aiConfigured && quota.remaining > 0 && !pending;

  function handleRun() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await runAnalysisAction(ruang, { period: data.periodChoice });
        if (!res.ok) {
          setError('Gagal menjalankan analisis. Periksa koneksi lalu coba lagi.');
          return;
        }
        const out = res.value;
        if (out.quota !== undefined) {
          setQuota((prev) => ({
            ...prev,
            used: out.quota?.used ?? prev.used,
            limit: out.quota?.limit ?? prev.limit,
            remaining: out.quota?.remaining ?? prev.remaining,
          }));
        }
        if (!out.ok) {
          setError(ERROR_COPY[out.code]);
          return;
        }
        setAnalysis(out.analysis);
      } catch {
        setError('Koneksi terputus. Analisis belum bisa dijalankan.');
      }
    });
  }

  return (
    <article className="flex flex-col gap-4 pb-6 laptop:max-w-180 laptop:pt-4">
      <div className="flex flex-col gap-1">
        <BackLink href={buildSectionHref(ruang, 'laporan', query)}>Laporan</BackLink>
        <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
          <h1 className="text-headline font-extrabold text-text">Analisis AI</h1>
          <span className="text-meta font-semibold text-text-muted">{RUANG_LABEL[ruang]}</span>
        </div>
        <p className="text-label font-medium text-text-soft">{data.periodLabel}</p>
      </div>

      {/* Pemilih periode: Periode ini / Periode lalu */}
      <nav aria-label="Pilih periode analisis" className="grid grid-cols-2 gap-2">
        {(
          [
            { key: 'current', label: 'Periode ini' },
            { key: 'previous', label: 'Periode lalu' },
          ] as const
        ).map((item) => {
          const active = data.periodChoice === item.key;
          return (
            <Link
              key={item.key}
              href={periodHref(ruang, item.key)}
              prefetch={false}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 items-center justify-center rounded-xl border px-3 text-label font-bold transition-colors ${
                active
                  ? 'border-accent bg-accent-tint text-accent-text'
                  : 'border-border bg-surface text-text-soft hover-pointer:bg-hover'
              } ${focusRing}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Ringkasan angka SQL — selalu tersedia tanpa AI */}
      {data.hasData ? (
        <section aria-label="Ringkasan periode" className={`flex flex-col gap-3 p-4 ${heroCard}`}>
          <div className="grid grid-cols-2 gap-3 tablet:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-caption font-semibold text-text-muted">Pemasukan</span>
              {data.income > 0 ? (
                <MoneyText value={data.income} kind="income" size="list" />
              ) : (
                <span className="text-body font-bold text-text-muted">Belum ada</span>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-caption font-semibold text-text-muted">Pengeluaran</span>
              {data.expense > 0 ? (
                <MoneyText value={data.expense} kind="expense" size="list" />
              ) : (
                <span className="text-body font-bold text-text-muted">Belum ada</span>
              )}
            </div>
            <div className="col-span-2 flex min-w-0 flex-col gap-0.5 border-t border-hairline pt-2 tablet:col-span-1 tablet:border-t-0 tablet:pt-0">
              <span className="text-caption font-semibold text-text-muted">Selisih bersih</span>
              {data.net !== 0 ? (
                <MoneyText
                  value={data.net}
                  kind={data.net > 0 ? 'income' : 'neutral'}
                  size="list"
                  signed
                />
              ) : (
                <span className="text-body font-bold text-text-muted">Impas</span>
              )}
            </div>
          </div>

          {data.safeToSpend !== null && data.safeToSpend > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2.5 text-meta font-medium text-text-soft">
              <span>
                {data.daysLeft !== null && data.daysLeft > 0
                  ? `Sisa aman · ${String(data.daysLeft)} hari lagi`
                  : 'Sisa aman periode ini'}
              </span>
              <MoneyText value={data.safeToSpend} kind="neutral" size="row" />
            </div>
          ) : null}
        </section>
      ) : (
        <EmptyState
          icon={<ChartLineUpIcon size={24} />}
          title="Belum ada transaksi di periode ini"
          description="Catat beberapa pemasukan atau pengeluaran dulu agar ringkasan dan analisis AI lebih bermakna."
        />
      )}

      {/* Kategori pengeluaran teratas dari SQL */}
      {data.topCategories.length > 0 ? (
        <section aria-label="Kategori pengeluaran teratas" className="flex flex-col gap-2">
          <h2 className="text-meta font-semibold text-text-soft">Pos pengeluaran terbesar</h2>
          <ul className={`px-4 ${card}`}>
            {data.topCategories.map((cat) => (
              <li
                key={cat.name}
                className={`flex min-h-12 items-center justify-between gap-3 py-2.5 ${rowDivider}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-semibold text-text">{cat.name}</p>
                  <p className="text-caption font-medium text-text-muted tabular-nums">
                    {`${String(cat.pct)}% · ${String(cat.entryCount)} transaksi`}
                  </p>
                </div>
                <MoneyText value={cat.amount} kind="expense" size="list" className="shrink-0" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Kartu tindakan & hasil Analisis AI */}
      <section aria-label="Ringkasan AI" className={`flex flex-col gap-3 p-4 ${card}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-body font-bold text-text">
            <LightningIcon size={18} className="shrink-0 text-accent-text" />
            Ringkasan AI
          </h2>
          <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-caption font-semibold text-text-soft tabular-nums">
            {`Kuota ${String(quota.remaining)} dari ${String(quota.limit)} hari ini`}
          </span>
        </div>

        <p className="flex items-start gap-1.5 text-meta font-medium text-text-muted">
          <InfoIcon size={15} className="mt-0.5 shrink-0" />
          Hanya angka ringkasan dan kategori teratas ruang ini yang dikirim. Deskripsi transaksi dan
          ruang lain tidak pernah dikirim.
        </p>

        {!data.hasData ? null : !data.aiConfigured ? (
          <p className="rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-meta font-medium text-text-soft">
            {ERROR_COPY.not_configured}
          </p>
        ) : quota.remaining === 0 && analysis === null ? (
          <p className="rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-meta font-medium text-text-soft">
            {ERROR_COPY.quota_exceeded}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              size="lg"
              disabled={!canRun}
              loading={pending}
              onClick={handleRun}
              className="w-full tablet:w-auto tablet:self-start"
            >
              <LightningIcon size={18} weight="bold" />
              {pending
                ? 'Menyusun ringkasan…'
                : analysis === null
                  ? 'Buat analisis AI'
                  : 'Perbarui analisis AI'}
            </Button>
            {quota.remaining === 0 ? (
              <p className="text-caption font-medium text-text-muted">
                Kuota harian sudah terpakai penuh. Terisi lagi besok pukul 00.00 WIB.
              </p>
            ) : null}
          </div>
        )}

        {error !== null ? (
          <p role="alert" className="text-meta font-semibold text-danger">
            {error}
          </p>
        ) : null}

        {analysis !== null ? (
          <div
            aria-label="Hasil analisis AI"
            className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4"
          >
            <div className="flex flex-col gap-1">
              <h3 className="text-caption font-bold uppercase tracking-wide text-text-muted">
                Ringkasan
              </h3>
              <p className="text-body font-medium text-text text-pretty">{analysis.ringkasan}</p>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
              <h3 className="text-caption font-bold uppercase tracking-wide text-text-muted">
                Sorotan
              </h3>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-label font-medium text-text-soft">
                {analysis.sorotan.map((item, idx) => (
                  <li key={`${String(idx)}-${item}`}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
              <h3 className="text-caption font-bold uppercase tracking-wide text-text-muted">
                Saran praktis
              </h3>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-label font-medium text-text-soft">
                {analysis.saran.map((item, idx) => (
                  <li key={`${String(idx)}-${item}`}>{item}</li>
                ))}
              </ul>
            </div>

            <p className="border-t border-hairline pt-2.5 text-caption font-medium text-text-muted">
              {`Disusun oleh AI (${PROVIDER_LABEL[analysis.provider]}) dari angka agregat ruang ini. Cek kembali angka utama di Laporan sebelum mengambil keputusan.`}
            </p>
          </div>
        ) : null}
      </section>
    </article>
  );
}

export function AnalisisFailed({ ruang, query }: { ruang: Ruang; query: string }) {
  return (
    <article className="flex flex-col gap-3 laptop:max-w-180 laptop:pt-4">
      <BackLink href={buildSectionHref(ruang, 'laporan', query)}>Laporan</BackLink>
      <ErrorState
        title="Analisis belum bisa dimuat."
        description="Periksa koneksi lalu coba lagi."
        actions={<RetryIsland />}
      />
    </article>
  );
}
