'use client';

import type { Rupiah } from '@dompetku/domain';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { CircleNotchIcon } from '@/components/ui/icons/circle-notch';
import { MinusCircleIcon } from '@/components/ui/icons/minus-circle';
import { PlusCircleIcon } from '@/components/ui/icons/plus-circle';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { MoneyInput } from '@/components/ui/money-input';
import { MoneyText } from '@/components/ui/money-text';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { newClientId } from '@/features/ledger/client-id';
import type { ActionResult, LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { signedRupiah } from './toasts';

/**
 * Cocokkan saldo (S7-W1): menyamakan saldo di aplikasi dengan saldo nyata lewat satu entri
 * penyesuaian sebesar selisih. Sheet ini hanya menampilkan pratinjau dan mengirim; toast (dengan
 * `Urungkan`) dan muat ulang saldo diatur pemanggil lewat `onSaved`. Dimuat malas oleh Dompet.
 */

export interface ReconcileSource {
  reconcile(req: {
    clientId: string;
    accountId: string;
    actualBalance: Rupiah;
  }): Promise<ActionResult<{ entryId: string | null; difference: number }>>;
}

export interface ReconcileSaved {
  /** Entri penyesuaian; `null` bila di server selisihnya sudah 0 (tidak ada yang dicatat). */
  entryId: string | null;
  /** Selisih sebenarnya dari server (bisa beda dari pratinjau bila saldo berubah). */
  difference: number;
}

export const RECONCILE_COPY = {
  currentLabel: 'Saldo di DompetKu',
  actualLabel: 'Saldo sebenarnya',
  save: 'Cocokkan saldo',
  retry: 'Coba lagi',
  saving: 'Menyimpan…',
  up: 'Akan dicatat penyesuaian naik. Pemasukan dan pengeluaran tidak berubah.',
  down: 'Akan dicatat penyesuaian turun. Pemasukan dan pengeluaran tidak berubah.',
  same: 'Saldo sudah sama. Tidak ada yang perlu dicocokkan.',
  empty: 'Isi saldo sebenarnya untuk melihat selisihnya.',
  network:
    'Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.',
  server: 'Belum tersimpan. Ada kendala di server. Coba lagi tidak akan mencatat dua kali.',
  idem: 'Penyesuaian ini mungkin sudah tersimpan. Tutup lalu periksa riwayat dompet.',
} as const;

function failedText(code: LedgerErrorCode, name: string): string {
  switch (code) {
    case 'network':
      return RECONCILE_COPY.network;
    case 'account_archived':
      return `${name} sudah diarsipkan.`;
    case 'idem_mismatch':
      return RECONCILE_COPY.idem;
    default:
      return RECONCILE_COPY.server;
  }
}

export interface ReconcileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruang: Ruang;
  account: { id: string; name: string; balance: Rupiah };
  source: ReconcileSource;
  /** Sesudah tersimpan (sheet sudah menutup): pemanggil menampilkan toast dan memuat ulang. */
  onSaved: (saved: ReconcileSaved) => void;
  /** Kunci sama, isi beda: percobaan sebelumnya mungkin sudah tersimpan; pemanggil memuat ulang. */
  onStale?: () => void;
  returnFocus?: HTMLElement | null;
}

const RUANG_NAME: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

export function ReconcileSheet(props: ReconcileSheetProps) {
  // Satu sesi per pembukaan: isian dan clientId lahir baru setiap sheet dibuka.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <ReconcileSession key={session} {...props} />;
}

function ReconcileSession({
  open,
  onOpenChange,
  ruang,
  account,
  source,
  onSaved,
  onStale,
  returnFocus,
}: ReconcileSheetProps) {
  const [actual, setActual] = useState<Rupiah | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<LedgerErrorCode | null>(null);
  const clientId = useRef(newClientId());
  const busy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const previewId = useId();
  const alertId = useId();

  const difference = actual === null ? null : actual - account.balance;
  const canSave = difference !== null && difference !== 0;

  async function submit(ev: SyntheticEvent) {
    ev.preventDefault();
    if (busy.current || !canSave || actual === null) return;
    busy.current = true;
    setSaving(true);
    setFailure(null);
    let res: Awaited<ReturnType<ReconcileSource['reconcile']>>;
    try {
      res = await source.reconcile({
        clientId: clientId.current,
        accountId: account.id,
        actualBalance: actual,
      });
    } catch {
      res = { ok: false, error: { code: 'network' } };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (!res.ok) {
      setFailure(res.error.code);
      if (res.error.code === 'idem_mismatch') onStale?.();
      return;
    }
    onOpenChange(false);
    onSaved(res.value);
  }

  const alertText = failure === null ? null : failedText(failure, account.name);

  const footer = (
    <>
      {alertText === null ? null : (
        <p
          id={alertId}
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-danger-tint p-3 text-label font-semibold text-danger"
        >
          <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
          <span className="text-pretty">{alertText}</span>
        </p>
      )}
      <Button
        type="submit"
        form={formId}
        aria-disabled={saving || !canSave || undefined}
        aria-busy={saving || undefined}
        aria-describedby={alertText === null ? previewId : `${previewId} ${alertId}`}
        className="w-full aria-disabled:border-hairline aria-disabled:bg-surface-2 aria-disabled:text-text-muted aria-disabled:hover-pointer:bg-surface-2"
      >
        {saving ? (
          <>
            <CircleNotchIcon
              size={18}
              weight="bold"
              className="shrink-0 motion-safe:animate-spin"
            />
            {RECONCILE_COPY.saving}
          </>
        ) : failure === 'network' ? (
          RECONCILE_COPY.retry
        ) : (
          RECONCILE_COPY.save
        )}
      </Button>
    </>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Esc/overlay/Tutup tidak menutup selama menyimpan.
        if (!next && saving) return;
        onOpenChange(next);
      }}
      title={`Cocokkan saldo · ${account.name}`}
      titleContent={
        <>
          <span className="min-w-0 break-words">{`Cocokkan saldo · ${account.name}`}</span>
          <SpaceTag space={ruang} />
        </>
      }
      tint={ruang}
      footer={footer}
      initialFocus={inputRef}
      returnFocus={returnFocus}
    >
      <form
        id={formId}
        noValidate
        onSubmit={(ev) => {
          void submit(ev);
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-label font-medium text-text-muted">{RECONCILE_COPY.currentLabel}</p>
          <MoneyText
            value={account.balance}
            size="inherit"
            className="text-heading font-bold text-text"
          />
        </div>
        <MoneyInput
          label={RECONCILE_COPY.actualLabel}
          size="hero"
          inputRef={inputRef}
          value={actual}
          onChange={setActual}
          readOnly={saving}
          describedBy={previewId}
        />
        <Preview id={previewId} difference={difference} />
        <p className="sr-only">{`Tanggal penyesuaian hari ini di ${RUANG_NAME[ruang]}.`}</p>
      </form>
    </Sheet>
  );
}

/** Pratinjau selisih (`role="status"`): berubah saat mengetik; tanda dan kata, bukan warna saja. */
function Preview({ id, difference }: { id: string; difference: number | null }) {
  return (
    <div
      id={id}
      role="status"
      aria-live="polite"
      className="flex min-h-11 flex-col justify-center gap-0.5"
    >
      {difference === null ? (
        <span className="sr-only">{RECONCILE_COPY.empty}</span>
      ) : difference === 0 ? (
        <p className="flex items-center gap-2 text-body font-bold text-accent-text">
          <CheckCircleIcon size={20} weight="fill" className="shrink-0" />
          {RECONCILE_COPY.same}
        </p>
      ) : (
        <>
          <p
            className={`flex items-center gap-2 text-body font-bold ${
              difference > 0 ? 'text-income' : 'text-warning'
            }`}
          >
            {difference > 0 ? (
              <PlusCircleIcon size={20} weight="fill" className="shrink-0" />
            ) : (
              <MinusCircleIcon size={20} weight="fill" className="shrink-0" />
            )}
            <span>
              Selisih <span className="num">{signedRupiah(difference)}</span>
            </span>
          </p>
          <p className="text-meta font-medium text-text-soft">
            {difference > 0 ? RECONCILE_COPY.up : RECONCILE_COPY.down}
          </p>
        </>
      )}
    </div>
  );
}
