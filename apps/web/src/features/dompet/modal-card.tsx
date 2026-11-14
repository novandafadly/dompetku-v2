import { formatRupiah } from '@dompetku/domain';
import { useId, type ReactNode } from 'react';
import { WarningIcon } from '@/components/ui/icons/warning';
import { MoneyText } from '@/components/ui/money-text';
import { card } from '@/components/ui/styles';
import type { TradingFiguresVM } from '@/features/ledger/types';

/** Salinan final S12-TR2/TR3 (`docs/design/s12-bingkai.md`). */
const COPY = {
  overview: 'Modal trading',
  detail: 'Modal',
  left: 'Sisa modal',
  balance: 'Saldo trading',
  deposited: 'Disetor',
  withdrawn: 'Ditarik',
  realized: 'Hasil ditarik',
  realizedNote: 'Penarikan di atas modal yang disetor.',
  allWithdrawn: 'Modal sudah ditarik semua.',
  empty: 'Belum ada modal yang disetor. Setor modal dari detail dompet trading.',
  shortfallNote: 'Saldo trading lebih kecil dari sisa modal yang kamu setor.',
} as const;

function Item({ label, children, note }: { label: string; children: ReactNode; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-meta font-semibold text-text-soft">{label}</dt>
      <dd className="flex flex-col gap-0.5">
        {children}
        {note === undefined ? null : (
          <span className="text-caption font-medium text-text-muted">{note}</span>
        )}
      </dd>
    </div>
  );
}

/**
 * Kartu modal trading (Server Component murni). `overview` = kartu `Modal trading` di Dompet
 * (total semua dompet trading), `detail` = kartu `Modal` satu dompet di riwayatnya. Semua angka
 * dari `api.trading_overview`; modal bukan pemasukan/pengeluaran, jadi netral tanpa hue (juga
 * `Hasil ditarik`), dan `Kurang` hanya peringatan `warning-tint`. Nol tidak ditulis "Rp 0":
 * kalimat (`Modal sudah ditarik semua.`) atau baris tidak dirender.
 */
export function ModalCard({
  variant,
  figures,
}: {
  variant: 'overview' | 'detail';
  figures: TradingFiguresVM;
}) {
  const id = useId();
  const detail = variant === 'detail';
  return (
    <section aria-labelledby={id} className={`flex flex-col gap-3 p-4 ${card}`}>
      <h2 id={id} className="text-body font-bold text-text">
        {detail ? COPY.detail : COPY.overview}
      </h2>
      {figures.hasDeposit ? (
        <>
          <dl className="flex flex-wrap gap-x-6 gap-y-3">
            <Item label={COPY.left}>
              {figures.capitalLeft > 0 ? (
                <MoneyText
                  value={figures.capitalLeft}
                  size="inherit"
                  className="text-headline font-extrabold"
                />
              ) : (
                <span className="text-body font-semibold text-text">{COPY.allWithdrawn}</span>
              )}
            </Item>
            {detail ? (
              <>
                <Item label={COPY.deposited}>
                  <MoneyText value={figures.capitalIn} />
                </Item>
                <Item label={COPY.withdrawn}>
                  <MoneyText value={figures.capitalOut} />
                </Item>
              </>
            ) : figures.balance === 0 ? null : (
              // Saldo nol tidak ditulis "Rp 0" (sisa modal/Kurang sudah menjelaskan).
              <Item label={COPY.balance}>
                <MoneyText value={figures.balance} />
              </Item>
            )}
            {figures.realized > 0 ? (
              <Item label={COPY.realized} note={COPY.realizedNote}>
                <MoneyText value={figures.realized} />
              </Item>
            ) : null}
          </dl>
          {figures.shortfall > 0 ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg bg-warning-tint p-3 text-warning"
            >
              <WarningIcon size={16} weight="fill" className="mt-0.5 shrink-0" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-label font-bold">{`Kurang ${formatRupiah(figures.shortfall)}`}</p>
                <p className="text-meta font-medium text-pretty">{COPY.shortfallNote}</p>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-label font-medium text-text-muted">{COPY.empty}</p>
      )}
    </section>
  );
}
