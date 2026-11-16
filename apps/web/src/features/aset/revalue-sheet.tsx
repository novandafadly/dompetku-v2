'use client';

import { shortDateLabel, type IsoDate, type Rupiah } from '@dompetku/domain';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { Alert } from '@/components/ui/form-parts';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { MinusCircleIcon } from '@/components/ui/icons/minus-circle';
import { PlusCircleIcon } from '@/components/ui/icons/plus-circle';
import { MoneyInput } from '@/components/ui/money-input';
import { SaveButton } from '@/components/ui/save-button';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { newClientId } from '@/features/ledger/client-id';
import type { ActionResult, LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { ASET_COPY as C } from './copy';
import { assetFailedText, FIELD_DATE, FIELD_VALUE } from './galat';

const FORM_ID = 'perbarui-nilai';
const MAX_VALUE = 10 ** 13;

export interface RevalueSource {
  revalue(req: {
    clientId: string;
    accountId: string;
    value: Rupiah;
    on?: IsoDate;
  }): Promise<ActionResult<{ entryId: string | null; delta: number }>>;
}

export interface RevalueSaved {
  /** Entri `valuation`; `null` bila di server nilainya sudah sama (tidak ada yang dicatat). */
  entryId: string | null;
  /** Perubahan sebenarnya dari server (bisa beda dari pratinjau bila nilai berubah sejak dibuka). */
  delta: number;
}

export interface RevalueSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruang: Ruang;
  today: IsoDate;
  /** `balance` = nilai tercatat; `lastOn` = tanggal valuasi/nilai awal terakhir (teks pembanding). */
  asset: { id: string; name: string; balance: Rupiah; lastOn: IsoDate | null };
  source: RevalueSource;
  onSaved: (saved: RevalueSaved) => void;
  /** Kunci sama, isi beda: percobaan sebelumnya mungkin sudah tersimpan; pemanggil memuat ulang. */
  onStale?: () => void;
  returnFocus?: HTMLElement | null;
}

/**
 * Sheet `Perbarui nilai` (S14-AS4): terima nilai sekarang, DB menghitung selisih dan mencatat satu
 * entri `valuation` (bukan pemasukan/pengeluaran). Pratinjau = satu pengurangan dari isian dan
 * nilai tercatat (preseden Cocokkan saldo); angka pasti dari server. Selisih 0 = sheet menutup tanpa
 * toast.
 */
export function RevalueSheet(props: RevalueSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <RevalueSession key={session} {...props} />;
}

function RevalueSession({
  open,
  onOpenChange,
  ruang,
  today,
  asset,
  source,
  onSaved,
  onStale,
  returnFocus,
}: RevalueSheetProps) {
  const [value, setValue] = useState<Rupiah | null>(null);
  const [on, setOn] = useState<string>(today);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<LedgerErrorCode | null>(null);
  const [dateError, setDateError] = useState<string | undefined>();
  const clientId = useRef(newClientId());
  const busy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const previewId = useId();

  const delta = value === null ? null : value - asset.balance;

  async function submit(ev?: SyntheticEvent) {
    ev?.preventDefault();
    if (busy.current || value === null) return;
    if (value < 0 || value > MAX_VALUE) {
      setFailure('invalid');
      return;
    }
    if (on > today) {
      setDateError(FIELD_DATE);
      dateRef.current?.focus();
      return;
    }
    if (delta === 0) {
      onOpenChange(false); // sama: tutup tanpa toast dan tanpa memanggil server
      return;
    }
    busy.current = true;
    setSaving(true);
    setFailure(null);
    setDateError(undefined);
    let res: Awaited<ReturnType<RevalueSource['revalue']>>;
    try {
      res = await source.revalue({
        clientId: clientId.current,
        accountId: asset.id,
        value,
        ...(on === today ? {} : { on }),
      });
    } catch {
      res = { ok: false, error: { code: 'network' } };
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (!res.ok) {
      if (res.error.code === 'idem_mismatch') onStale?.();
      if (res.error.code === 'before_latest_entry' || res.error.code === 'before_opening') {
        setDateError(assetFailedText(res.error.code, asset.name));
        dateRef.current?.focus();
        return;
      }
      setFailure(res.error.code);
      return;
    }
    onOpenChange(false);
    onSaved(res.value);
  }

  const alertText =
    failure === null
      ? null
      : failure === 'invalid'
        ? FIELD_VALUE
        : assetFailedText(failure, asset.name);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return;
        onOpenChange(next);
      }}
      title={C.revalueTitle(asset.name, ruang)}
      titleContent={
        <>
          <span className="min-w-0 break-words">{`${C.revalue} ${asset.name}`}</span>
          <SpaceTag space={ruang} />
        </>
      }
      tint={ruang}
      initialFocus={inputRef}
      returnFocus={returnFocus}
      footer={<SaveButton formId={FORM_ID} saving={saving} label={C.saveValue} />}
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(ev) => {
          void submit(ev);
        }}
        className="flex flex-col gap-3"
      >
        <p className="text-meta font-medium text-text-soft">
          {asset.lastOn === null
            ? C.recordedNoDate(asset.balance)
            : C.recorded(asset.balance, shortDateLabel(asset.lastOn))}
        </p>
        <MoneyInput
          label={C.valueField}
          size="hero"
          inputRef={inputRef}
          value={value}
          onChange={(v) => {
            setValue(v);
            setFailure(null);
          }}
          readOnly={saving}
          describedBy={previewId}
        />
        <Preview id={previewId} delta={delta} />
        <DateInput
          label={C.dateField}
          value={on}
          onChange={(v) => {
            setOn(v);
            setDateError(undefined);
          }}
          max={today}
          error={dateError}
          busy={saving}
          inputRef={dateRef}
        />
        <p className="text-caption font-medium text-text-muted">{C.revalueHint}</p>
      </form>
      {alertText === null ? null : (
        <Alert
          action={
            failure === 'network' || failure === 'unknown' ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void submit();
                }}
              >
                Coba lagi
              </Button>
            ) : undefined
          }
        >
          {alertText}
        </Alert>
      )}
      <div aria-hidden="true" className="pb-3" />
    </Sheet>
  );
}

/** Pratinjau perubahan (`aria-live`): kata + ikon, netral (bukan pemasukan/pengeluaran). */
function Preview({ id, delta }: { id: string; delta: number | null }) {
  return (
    <div
      id={id}
      role="status"
      aria-live="polite"
      className="flex min-h-11 flex-col justify-center gap-0.5"
    >
      {delta === null ? (
        <span className="sr-only">{C.empty}</span>
      ) : delta === 0 ? (
        <p className="flex items-center gap-2 text-body font-bold text-text-soft">
          <CheckCircleIcon size={20} weight="fill" className="shrink-0" />
          {C.same}
        </p>
      ) : (
        <p className="flex items-center gap-2 text-body font-bold text-text">
          {delta > 0 ? (
            <PlusCircleIcon size={20} weight="fill" className="shrink-0" />
          ) : (
            <MinusCircleIcon size={20} weight="fill" className="shrink-0" />
          )}
          <span className="num">{delta > 0 ? C.up(delta) : C.down(delta)}</span>
        </p>
      )}
    </div>
  );
}
