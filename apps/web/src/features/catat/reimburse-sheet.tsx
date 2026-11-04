'use client';

import { addDays, dayLabel, formatRupiah, type IsoDate } from '@dompetku/domain';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CalendarBlankIcon } from '@/components/ui/icons/calendar-blank';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { MoneyInput } from '@/components/ui/money-input';
import { Sheet } from '@/components/ui/sheet';
import { toast } from '@/components/ui/toast';
import {
  accountArchivedText,
  beforeOpeningText,
  CATAT_COPY,
  CatatAlert,
  FieldErrorText,
  galatText,
  SavingLabel,
} from './catat-status';
import { newClientId } from './client-id';
import { undoOrNotify } from './saved-toast';
import { MetaSelect } from './wallet-picker';
import type { AccountVM, ActionResult, EntryVM, LedgerErrorCode } from '@/features/ledger/types';

/**
 * Detail talangan (S7-D3): sheet `Catat reimburse` dan dialog `Tidak diganti`. Dimuat malas oleh
 * Detail saat pertama dipakai. Sumber = Server Action ruang Pribadi (`detail-reimburse.tsx`).
 */

export interface ReimburseSource {
  create(req: {
    clientId: string;
    entryId: string;
    accountId: string;
    amount: number;
    occurredOn: IsoDate;
  }): Promise<ActionResult<{ entryId: string }>>;
  /** Batalkan reimburse yang baru dicatat ("Urungkan"); `true` bila berhasil. */
  undo(entryId: string): Promise<boolean>;
  /** Tandai talangan jadi pengeluaran biasa (`reimbursable: false`). */
  notReimbursed(req: { clientId: string; entry: EntryVM }): Promise<ActionResult<unknown>>;
}

export const REIMBURSE_COPY = {
  title: 'Reimburse talangan · Pribadi',
  amount: 'Jumlah diganti',
  toWallet: 'Ke dompet',
  date: 'Tanggal',
  save: 'Simpan reimburse',
  amountRequired: 'Isi jumlah diganti untuk menyimpan',
  exceeds: 'Jumlah ini lebih besar dari sisa yang belum diganti. Kurangi jumlahnya.',
  notReimbursable: 'Transaksi ini bukan talangan yang menunggu diganti. Muat ulang halaman.',
  exists: 'Talangan ini sudah punya reimburse. Batalkan reimburse itu dulu.',
  undoFailed: 'Belum bisa diurungkan. Buka reimburse itu untuk membatalkannya.',
  notTitle: 'Tandai tidak diganti?',
  notBody:
    'Pengeluaran ini jadi pengeluaran pribadi biasa dan masuk hitungan Pribadi. Bisa ditandai talangan lagi lewat Ubah.',
  notConfirm: 'Tandai tidak diganti',
  notDone: 'Ditandai tidak diganti di Pribadi',
} as const;

/** Hari ini dan 13 hari ke belakang. */
const DATE_CHOICES = 14;

/** Galat simpan reimburse selain `reimbursement_exceeds` (kolom sendiri); kotak `role="alert"`. */
export function reimburseFailedText(code: LedgerErrorCode, accountName: string, opened?: IsoDate) {
  switch (code) {
    case 'not_reimbursable':
      return REIMBURSE_COPY.notReimbursable;
    case 'reimbursement_exists':
      return REIMBURSE_COPY.exists;
    case 'account_archived':
      return accountArchivedText(accountName);
    case 'before_opening':
      return opened === undefined
        ? 'Tanggal ini lebih awal dari saat dompet dibuka. Pilih tanggal lain.'
        : beforeOpeningText(accountName, opened);
    case 'network':
      return galatText('network');
    case 'not_found':
      return galatText('not_found');
    default:
      return galatText('server');
  }
}

export interface ReimburseSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Talangan (pengeluaran Pribadi reimbursable, hidup). */
  entry: EntryVM;
  /** Sisa yang belum diganti (default `Jumlah diganti`). */
  remaining: number;
  /** Dompet Pribadi ruang ini; Kantor dan terarsip tidak ditawarkan. */
  accounts: AccountVM[];
  today: IsoDate;
  source: ReimburseSource;
  /** Sesudah tersimpan (sheet sudah menutup, toast tampil): pemanggil mengatur fokus. */
  onSaved?: () => void;
  returnFocus?: HTMLElement | null;
}

export function ReimburseSheet(props: ReimburseSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <ReimburseSession key={session} {...props} />;
}

function ReimburseSession({
  open,
  onOpenChange,
  entry,
  remaining,
  accounts,
  today,
  source,
  onSaved,
  returnFocus,
}: ReimburseSheetProps) {
  const choices = accounts.filter((a) => !a.archived && a.pocket !== 'kantor');
  const [amount, setAmount] = useState<number | null>(remaining);
  const [accountId, setAccountId] = useState(
    choices.find((a) => a.id === entry.accountId)?.id ?? choices[0]?.id ?? '',
  );
  const [date, setDate] = useState<IsoDate>(today);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<LedgerErrorCode | null>(null);
  const clientId = useRef(newClientId());
  const busy = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const alertId = useId();
  const errorId = useId();

  const account = choices.find((a) => a.id === accountId);
  const canSave = amount !== null && amount > 0 && account !== undefined;
  const dates = [
    ...new Set([...Array.from({ length: DATE_CHOICES }, (_, i) => addDays(today, -i)), date]),
  ]
    .filter((d) => d <= today && (d >= entry.occurredOn || d === date))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  async function submit(ev: SyntheticEvent) {
    ev.preventDefault();
    if (busy.current || !canSave) return;
    busy.current = true;
    setSaving(true);
    setFailure(null);
    let res: Awaited<ReturnType<ReimburseSource['create']>>;
    try {
      res = await source.create({
        clientId: clientId.current,
        entryId: entry.id,
        accountId,
        amount,
        occurredOn: date,
      });
    } catch {
      res = { ok: false, error: { code: 'network' } };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (!res.ok) {
      setFailure(res.error.code);
      if (res.error.code === 'reimbursement_exceeds') amountRef.current?.focus();
      return;
    }
    const newId = res.value.entryId;
    toast({
      message: `Reimburse tersimpan di Pribadi · ${formatRupiah(amount)}`,
      action: {
        label: 'Urungkan',
        onAction: () => {
          void undoOrNotify(() => source.undo(newId), newId, toast, REIMBURSE_COPY.undoFailed);
        },
      },
    });
    onOpenChange(false);
    onSaved?.();
  }

  const exceeds = failure === 'reimbursement_exceeds';
  const alertText =
    failure === null || exceeds
      ? null
      : reimburseFailedText(failure, account?.name ?? '', account?.openedOn);

  const footer = (
    <>
      {alertText === null ? null : (
        <CatatAlert id={alertId} tone="danger">
          {alertText}
        </CatatAlert>
      )}
      <p role="status" className="sr-only">
        {saving ? CATAT_COPY.menyimpan : ''}
      </p>
      <Button
        type="submit"
        form={formId}
        aria-disabled={saving || !canSave || undefined}
        aria-busy={saving || undefined}
        aria-describedby={alertText === null ? undefined : alertId}
        className="flex-1 aria-disabled:border-hairline aria-disabled:bg-surface-2 aria-disabled:text-text-muted aria-disabled:hover-pointer:bg-surface-2"
      >
        {saving ? (
          <SavingLabel />
        ) : failure === 'network' ? (
          CATAT_COPY.cobaLagi
        ) : (
          REIMBURSE_COPY.save
        )}
      </Button>
    </>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return;
        onOpenChange(next);
      }}
      title={REIMBURSE_COPY.title}
      tint="pribadi"
      footer={footer}
      initialFocus={amountRef}
      returnFocus={returnFocus}
      fill
    >
      <form
        id={formId}
        onSubmit={(ev) => {
          void submit(ev);
        }}
        className="flex flex-col gap-3"
      >
        <MoneyInput
          label={REIMBURSE_COPY.amount}
          size="hero"
          inputRef={amountRef}
          value={amount}
          onChange={setAmount}
          readOnly={saving}
          {...(exceeds ? { describedBy: errorId } : {})}
        />
        {exceeds ? <FieldErrorText id={errorId}>{REIMBURSE_COPY.exceeds}</FieldErrorText> : null}
        <div className="flex gap-2">
          <MetaSelect
            label={REIMBURSE_COPY.toWallet}
            icon={<WalletIcon size={18} />}
            value={accountId}
            onChange={setAccountId}
            options={choices.map((a) => ({ value: a.id, label: a.name }))}
            busy={saving}
          />
          <MetaSelect
            label={REIMBURSE_COPY.date}
            icon={<CalendarBlankIcon size={18} />}
            value={date}
            dataDate={date}
            onChange={(v) => {
              setDate(v);
            }}
            options={dates.map((d) => ({ value: d, label: dayLabel(d, today) }))}
            busy={saving}
          />
        </div>
      </form>
    </Sheet>
  );
}

/** Dialog `Tandai tidak diganti?` (S7-D3): dialog tetap terbuka dengan pesan bila ditolak. */
export function NotReimbursedDialog({
  open,
  onOpenChange,
  entry,
  source,
  onDone,
  onConflict,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: EntryVM;
  source: ReimburseSource;
  /** Sesudah berhasil (toast tampil, dialog menutup): pemanggil mengatur fokus. */
  onDone?: () => void;
  /** Konflik versi: pemanggil memuat ulang Detail. */
  onConflict?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<LedgerErrorCode | null>(null);
  const clientId = useRef(newClientId());
  const running = useRef(false);

  async function confirm() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailure(null);
    let res: Awaited<ReturnType<ReimburseSource['notReimbursed']>>;
    try {
      res = await source.notReimbursed({ clientId: clientId.current, entry });
    } catch {
      res = { ok: false, error: { code: 'network' } };
    } finally {
      running.current = false;
      setBusy(false);
    }
    if (res.ok) {
      toast({ message: REIMBURSE_COPY.notDone });
      onOpenChange(false);
      onDone?.();
      return;
    }
    if (res.error.code === 'conflict') {
      clientId.current = newClientId();
      onConflict?.();
    }
    setFailure(res.error.code);
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
        if (!next) setFailure(null);
      }}
      tone="primary"
      holdOpen
      busy={busy}
      title={REIMBURSE_COPY.notTitle}
      description={REIMBURSE_COPY.notBody}
      confirmLabel={REIMBURSE_COPY.notConfirm}
      cancelLabel="Kembali"
      alert={failure === null ? undefined : notFailedText(failure)}
      onConfirm={() => {
        void confirm();
      }}
    />
  );
}

function notFailedText(code: LedgerErrorCode): string {
  if (code === 'reimbursement_exists') return REIMBURSE_COPY.exists;
  if (code === 'not_reimbursable') return REIMBURSE_COPY.notReimbursable;
  if (code === 'conflict') return 'Transaksi ini baru saja diubah. Muat ulang lalu coba lagi.';
  if (code === 'network') return 'Belum bisa disimpan. Periksa koneksi lalu coba lagi.';
  return 'Belum bisa disimpan. Ada kendala di server.';
}
