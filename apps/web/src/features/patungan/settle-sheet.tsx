'use client';

import { addDays, dayLabel, formatRupiah, type IsoDate, type Rupiah } from '@dompetku/domain';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { FieldError, FieldHint } from '@/components/ui/field-messages';
import { Alert, SelectField } from '@/components/ui/form-parts';
import { MoneyInput } from '@/components/ui/money-input';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { newClientId } from '@/features/ledger/client-id';
import type { LedgerErrorCode } from '@/features/ledger/types';
import { NoAccountBlock, SaveButton, WarningBox } from './fields';
import { KolomKas } from '@/components/ui/kolom-kas';
import { PATUNGAN_COPY as C } from '@/features/ledger/patungan-copy';
import { patunganFailedText } from './galat';
import type { SplitBalanceVM, WalletsState } from '@/features/ledger/patungan-types';

const FORM_ID = 'lunasi-patungan';
const MAX_AMOUNT = 10 ** 13;
/** Tanggal pelunasan: hari ini sampai 13 hari lalu (pola Bayar utang). */
const DATE_CHOICES = 14;

export interface SettleSubmit {
  clientId: string;
  accountId: string;
  amount: Rupiah;
  occurredOn: IsoDate;
  allowNegative: boolean;
}
export type SettleResult =
  | { ok: true; settlementId: string; amount: Rupiah }
  | { ok: false; code: LedgerErrorCode; field?: string };

export interface SettledInfo {
  settlementId: string;
  amount: Rupiah;
  accountName: string;
}

export interface SettleSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Saldo patungan TERBARU dari halaman (utang berubah sesudah muat ulang). */
  balance: SplitBalanceVM;
  wallets: WalletsState;
  today: IsoDate;
  onSettle: (input: SettleSubmit) => Promise<SettleResult>;
  onSettled: (info: SettledInfo) => void;
  /** Muat ulang data halaman (sheet tetap terbuka). */
  onRefresh: () => void;
  onReloadWallets: () => void;
}

type Galat = 'network' | 'server' | 'idem' | 'gone';

/**
 * Sheet `Lunasi patungan · Bersama` (S12-PT3): pengutang mengembalikan bagiannya dari dompet
 * pribadinya. Utang selalu terlihat, bayar lebih tidak bisa lolos (galat kolom + `Lunasi semua` yang
 * MENGISI kolom, tidak menyimpan). Satu `clientId` per pembukaan (klik ganda = satu pelunasan).
 * Dompet Pribadi dimuat malas (R27): data tidak lewat props rute Bersama.
 */
export function SettleSheet(props: SettleSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <SettleSession key={session} {...props} />;
}

function SettleSession({
  open,
  onOpenChange,
  balance,
  wallets,
  today,
  onSettle,
  onSettled,
  onRefresh,
  onReloadWallets,
}: SettleSheetProps) {
  const owed = balance.debtorId === balance.me.id ? (balance.amount ?? 0) : 0;
  const partner = balance.partner.name;
  const accounts = wallets.data?.accounts ?? [];
  const [clientId] = useState(newClientId);
  const [amount, setAmount] = useState<Rupiah | null>(owed > 0 ? owed : null);
  const [picked, setPicked] = useState('');
  const [date, setDate] = useState<string>(today);
  const [saving, setSaving] = useState(false);
  const [forced, setForced] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverExceeds, setServerExceeds] = useState(false);
  const [errors, setErrors] = useState<{
    account?: string | undefined;
    date?: string | undefined;
    amount?: string | undefined;
  }>({});
  const [galat, setGalat] = useState<Galat | null>(null);
  const busy = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLSelectElement>(null);
  const errorId = useId();

  // Dompet bawaan = operasional pertama; dipilih saat daftar tiba (bukan di initializer).
  const accountId =
    accounts.find((a) => a.id === picked)?.id ??
    (accounts.find((a) => a.pocket === 'operasional') ?? accounts[0])?.id ??
    '';
  const account = accounts.find((a) => a.id === accountId);
  const gone = owed === 0 || galat === 'gone';
  const exceeds = (amount !== null && amount > owed) || serverExceeds;
  const valid = amount !== null && amount > 0 && amount <= owed;
  const negative = valid && account !== undefined && account.balance - amount < 0;
  const dates = Array.from({ length: DATE_CHOICES }, (_, i) => addDays(today, -i));
  const footerLabel = negative || forced ? C.anyway : `Lunasi ${formatRupiah(amount ?? owed)}`;
  const amountError =
    errors.amount ??
    (exceeds ? patunganFailedText('payment_exceeds') : undefined) ??
    (attempted && (amount === null || amount <= 0) ? 'Isi jumlah yang dilunasi.' : undefined);

  async function settle() {
    if (busy.current) return;
    setAttempted(true);
    const next: typeof errors = {};
    if (amount === null || amount <= 0) next.amount = 'Isi jumlah yang dilunasi.';
    else if (amount > MAX_AMOUNT) next.amount = 'Jumlah terlalu besar.';
    else if (amount > owed) next.amount = patunganFailedText('payment_exceeds');
    if (account === undefined) next.account = 'Pilih dompet pribadi.';
    setErrors(next);
    setGalat(null);
    if (next.amount !== undefined || amount === null) return amountRef.current?.focus();
    if (next.account !== undefined || account === undefined) return accountRef.current?.focus();
    busy.current = true;
    setSaving(true);
    let res: SettleResult;
    try {
      res = await onSettle({
        clientId,
        accountId: account.id,
        amount,
        occurredOn: date,
        allowNegative: negative || forced,
      });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (res.ok) {
      onSettled({ settlementId: res.settlementId, amount, accountName: account.name });
      return;
    }
    switch (res.code) {
      case 'payment_exceeds':
        // Tagihan lain berubah lebih dulu: muat ulang, galat yang sama; `Lunasi semua` memakai utang baru.
        setServerExceeds(true);
        onRefresh();
        amountRef.current?.focus();
        break;
      case 'saldo_negatif':
        setForced(true);
        break;
      case 'account_archived':
      case 'split_account_invalid':
        setErrors({ account: patunganFailedText(res.code) });
        accountRef.current?.focus();
        break;
      case 'before_opening':
        setErrors({ date: patunganFailedText(res.code) });
        dateRef.current?.focus();
        break;
      case 'not_found':
      case 'split_needs_partner':
        setGalat('gone');
        break;
      case 'idem_mismatch':
        setGalat('idem');
        break;
      case 'network':
        setGalat('network');
        break;
      default:
        setGalat('server');
    }
  }

  const galatText =
    galat === 'idem'
      ? 'Catatan ini sudah dikirim dengan isi lain. Tutup sheet lalu buka lagi.'
      : galat === 'server'
        ? 'Belum tersimpan. Ada kendala di server. Coba lagi tidak akan mencatat dua kali.'
        : 'Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.';
  const ready = wallets.status === 'ready';

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      title={C.settleTitle}
      titleContent={
        <>
          <span className="min-w-0 break-words">Lunasi patungan</span>
          <SpaceTag space="bersama" />
        </>
      }
      tint="bersama"
      initialFocus={ready && accounts.length > 0 && !gone ? amountRef : undefined}
      footer={
        ready && accounts.length > 0 && !gone ? (
          <SaveButton formId={FORM_ID} saving={saving} label={footerLabel} />
        ) : undefined
      }
    >
      {gone ? (
        <Alert
          action={
            <Button variant="secondary" size="sm" onClick={onRefresh}>
              Muat ulang
            </Button>
          }
        >
          Tidak ada patungan yang perlu dilunasi. Muat ulang halaman.
        </Alert>
      ) : wallets.status === 'error' ? (
        <Alert
          action={
            <Button variant="secondary" size="sm" onClick={onReloadWallets}>
              {C.retry}
            </Button>
          }
        >
          Dompet belum bisa dimuat. Periksa koneksi lalu coba lagi.
        </Alert>
      ) : !ready ? (
        <p role="status" className="py-3 text-label font-semibold text-text-muted">
          {C.loadingWallet}
        </p>
      ) : accounts.length === 0 ? (
        <NoAccountBlock text={C.noPersonalWallet} />
      ) : (
        <>
          <p className="text-body font-bold text-text">
            {`Kamu berutang ${formatRupiah(owed)} ke ${partner}`}
          </p>
          <form
            id={FORM_ID}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void settle();
            }}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <MoneyInput
                label={C.settleAmount}
                value={amount}
                onChange={(v) => {
                  setAmount(v);
                  setForced(false);
                  setServerExceeds(false);
                  setErrors((x) => ({ ...x, amount: undefined }));
                }}
                readOnly={saving}
                inputRef={amountRef}
                {...(amountError === undefined ? {} : { describedBy: errorId })}
              />
              {amountError === undefined ? null : (
                <div role={attempted ? 'alert' : undefined}>
                  <FieldError id={errorId}>{amountError}</FieldError>
                </div>
              )}
              {exceeds ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    setAmount(owed);
                    setServerExceeds(false);
                    setErrors((x) => ({ ...x, amount: undefined }));
                    amountRef.current?.focus();
                  }}
                >
                  {`Lunasi semua ${formatRupiah(owed)}`}
                </Button>
              ) : null}
            </div>
            <ChipGroup label="Jumlah cepat">
              <Chip
                selected={amount === owed}
                focusable
                ariaDisabled={saving}
                onSelect={() => {
                  setAmount(owed);
                  setForced(false);
                  setServerExceeds(false);
                  setErrors((x) => ({ ...x, amount: undefined }));
                }}
              >
                {C.all}
              </Chip>
            </ChipGroup>
            {(negative || forced) && account !== undefined ? (
              <WarningBox>
                {valid
                  ? `Saldo ${account.name} tinggal ${formatRupiah(account.balance)}. Kalau dilunasi, saldonya jadi −${formatRupiah(amount - account.balance)}.`
                  : 'Saldo dompet ini tidak cukup. Kalau dilunasi, saldonya jadi negatif.'}
              </WarningBox>
            ) : null}
            <div className="grid grid-cols-1 gap-3 min-[390px]:grid-cols-2">
              <SelectField
                label={C.fromWallet}
                value={accountId}
                onChange={(v) => {
                  setPicked(v);
                  setForced(false);
                  setErrors((x) => ({ ...x, account: undefined }));
                }}
                error={errors.account}
                selectRef={accountRef}
                busy={saving}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id} className="bg-surface text-text">
                    {a.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={C.date}
                value={date}
                onChange={(v) => {
                  setDate(v);
                  setErrors((x) => ({ ...x, date: undefined }));
                }}
                error={errors.date}
                selectRef={dateRef}
                busy={saving}
              >
                {dates.map((d) => (
                  <option key={d} value={d} className="bg-surface text-text">
                    {dayLabel(d, today)}
                  </option>
                ))}
              </SelectField>
            </div>
          </form>
          {valid && account !== undefined ? (
            <div className="flex flex-col gap-1">
              <KolomKas
                caption={C.afterThis}
                title={C.afterThis}
                rows={[
                  { label: `Utang ke ${partner} sekarang`, value: owed },
                  { label: C.paidOff, value: -amount, signed: true },
                ]}
                result={{ label: C.afterwards, value: owed - amount, lunas: true }}
              />
              <FieldHint id={`${errorId}-w`}>
                {`Saldo ${account.name} berkurang ${formatRupiah(amount)}`}
              </FieldHint>
            </div>
          ) : null}
          <p className="text-meta font-medium text-text-soft">
            {`Uangnya menunggu di Bersama sampai ${partner} menerimanya ke dompetnya.`}
          </p>
          {galat === null ? null : (
            <Alert
              action={
                galat === 'network' || galat === 'server' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void settle();
                    }}
                  >
                    {C.retry}
                  </Button>
                ) : undefined
              }
            >
              {galatText}
            </Alert>
          )}
          <div aria-hidden="true" className="pb-3" />
        </>
      )}
    </Sheet>
  );
}
