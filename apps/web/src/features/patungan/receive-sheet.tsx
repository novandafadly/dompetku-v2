'use client';

import { formatRupiah, type IsoDate, type Rupiah } from '@dompetku/domain';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, SelectField } from '@/components/ui/form-parts';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { newClientId } from '@/features/ledger/client-id';
import type { LedgerErrorCode } from '@/features/ledger/types';
import { NoAccountBlock, SaveButton } from '@/features/utang/fields';
import { PATUNGAN_COPY as C } from './copy';
import { patunganFailedText } from './galat';
import type { PendingSettlementVM, SplitBalanceVM, WalletsState } from './types';

const FORM_ID = 'terima-patungan';

export interface ReceiveSubmit {
  clientId: string;
  settlementId: string;
  accountId: string;
  occurredOn?: IsoDate;
}
export type ReceiveResult =
  | { ok: true; settlementId: string; amount: Rupiah }
  | { ok: false; code: LedgerErrorCode; field?: string };

export interface ReceivedInfo {
  settlementId: string;
  amount: Rupiah;
  accountName: string;
}

export interface ReceiveSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: SplitBalanceVM;
  /** Pelunasan yang diterima; `null` = tidak ada (sudah diterima/dibatalkan sejak halaman dimuat). */
  settlement: PendingSettlementVM | null;
  wallets: WalletsState;
  onReceive: (input: ReceiveSubmit) => Promise<ReceiveResult>;
  onReceived: (info: ReceivedInfo) => void;
  onRefresh: () => void;
  onReloadWallets: () => void;
}

/**
 * Sheet `Terima pelunasan · Bersama` (S12-PT4): penerima memindahkan uang pelunasan dari Bersama ke
 * dompet Pribadinya. Bukan pemasukan (`Ini bukan pemasukan`). Satu `clientId` per pembukaan.
 */
export function ReceiveSheet(props: ReceiveSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <ReceiveSession key={session} {...props} />;
}

function ReceiveSession({
  open,
  onOpenChange,
  balance,
  settlement,
  wallets,
  onReceive,
  onReceived,
  onRefresh,
  onReloadWallets,
}: ReceiveSheetProps) {
  const accounts = wallets.data?.accounts ?? [];
  const [clientId] = useState(newClientId);
  const [picked, setPicked] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const busy = useRef(false);
  const accountRef = useRef<HTMLSelectElement>(null);
  const accountId =
    accounts.find((a) => a.id === picked)?.id ??
    (accounts.find((a) => a.pocket === 'operasional') ?? accounts[0])?.id ??
    '';
  const account = accounts.find((a) => a.id === accountId);
  const gone = settlement === null;
  const ready = wallets.status === 'ready';
  const from = balance.partner.name;

  async function receive() {
    if (busy.current || settlement === null) return;
    if (account === undefined) {
      setFieldError('Pilih dompet pribadi.');
      accountRef.current?.focus();
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    setFieldError(undefined);
    let res: ReceiveResult;
    try {
      res = await onReceive({ clientId, settlementId: settlement.id, accountId: account.id });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (res.ok) {
      onReceived({ settlementId: res.settlementId, amount: res.amount, accountName: account.name });
      return;
    }
    if (res.code === 'account_archived' || res.code === 'split_account_invalid') {
      setFieldError(patunganFailedText(res.code));
      accountRef.current?.focus();
    } else {
      setError(patunganFailedText(res.code));
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      title={C.receiveTitle}
      titleContent={
        <>
          <span className="min-w-0 break-words">Terima pelunasan</span>
          <SpaceTag space="bersama" />
        </>
      }
      tint="bersama"
      footer={
        ready && accounts.length > 0 && !gone ? (
          <SaveButton
            formId={FORM_ID}
            saving={saving}
            label={`Terima ${formatRupiah(settlement.amount)}`}
          />
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
          Pelunasan ini sudah diterima atau dibatalkan. Muat ulang halaman.
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
            {`${from} melunasi ${formatRupiah(settlement.amount)}`}
          </p>
          <form
            id={FORM_ID}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void receive();
            }}
            className="flex flex-col gap-3"
          >
            <SelectField
              label={C.receiveTo}
              value={accountId}
              onChange={(v) => {
                setPicked(v);
                setFieldError(undefined);
              }}
              error={fieldError}
              selectRef={accountRef}
              busy={saving}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id} className="bg-surface text-text">
                  {a.name}
                </option>
              ))}
            </SelectField>
          </form>
          {account === undefined ? null : (
            <p className="text-meta font-medium text-text-soft">
              {`Saldo ${account.name} bertambah ${formatRupiah(settlement.amount)}. Ini bukan pemasukan.`}
            </p>
          )}
          {error === null ? null : (
            <Alert
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void receive();
                  }}
                >
                  {C.retry}
                </Button>
              }
            >
              {error}
            </Alert>
          )}
          <div aria-hidden="true" className="pb-3" />
        </>
      )}
    </Sheet>
  );
}
