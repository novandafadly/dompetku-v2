'use client';

import { addDays, dayLabel, type IsoDate } from '@dompetku/domain';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Combobox } from '@/components/ui/combobox';
import { FieldLabel } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { ArrowLeftIcon } from '@/components/ui/icons/arrow-left';
import { CalendarBlankIcon } from '@/components/ui/icons/calendar-blank';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { MoneyInput } from '@/components/ui/money-input';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { toast } from '@/components/ui/toast';
import type { AccountVM, CategoryVM, EntryVM, Ruang } from '@/features/ledger/types';
import {
  accountArchivedText,
  beforeOpeningText,
  categoryArchivedText,
  CATAT_COPY,
  CatatAlert,
  FieldErrorText,
  galatText,
  SaldoKurangRow,
  SavingLabel,
  saldoKurangText,
} from './catat-status';
import { InfoIcon } from '@/components/ui/icons/info';
import { CategoryChips } from './category-chips';
import { ConflictNotice } from './conflict-notice';
import { amountOnly, useEditEntry, type EditGalat, type EditSource } from './use-edit-entry';
import { MetaSelect } from './wallet-picker';

export type { EditInput, EditSource } from './use-edit-entry';

/** Salinan S6-D1 (docs/design/s6-bingkai.md). */
export const EDIT_COPY = {
  title: 'Ubah transaksi',
  save: 'Simpan perubahan',
  reload: 'Muat ulang',
  overwrite: 'Timpa dengan perubahan saya',
  /** Alasan Timpa nonaktif (aria-describedby), gaya `Pilih kategori untuk menyimpan`. */
  overwriteNeedsAmount: 'Isi nominal untuk menimpa',
  overwriteNeedsCategory: 'Pilih kategori untuk menimpa',
  voided: 'Transaksi ini sudah dibatalkan.',
} as const;

export const editedToast = (ruang: string) => `Perubahan tersimpan di ${ruang}`;

const RUANG_NAME: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

const KIND_NAME: Record<'income' | 'expense' | 'opening_balance', string> = {
  income: 'Pemasukan',
  expense: 'Pengeluaran',
  opening_balance: 'Saldo awal',
};

/** Galat simpan Ubah. `not_found` dan `voided` tidak bisa dicoba lagi: tutup lalu lihat detail. */
function editGalatText(kind: EditGalat): string {
  if (kind === 'voided') return EDIT_COPY.voided;
  if (kind === 'not_found') return 'Transaksi ini sudah tidak ada. Tutup untuk kembali.';
  return galatText(kind);
}

/** Hari ini dan 13 hari ke belakang, plus tanggal entri bila lebih lama (tidak ke masa depan). */
const DATE_CHOICES = 14;

export interface EditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruang: Ruang;
  /** Entri yang diubah (versi yang sedang ditampilkan Detail). */
  entry: EntryVM;
  /** Dompet dan kategori ruang ini. */
  accounts: AccountVM[];
  categories: CategoryVM[];
  /** Hari ini WIB dari server. */
  today: IsoDate;
  /** Id pengguna sekarang (konflik dari tab sendiri = `Kamu`). */
  me: string;
  source: EditSource;
  /** Sesudah tersimpan (sheet sudah menutup dan toast tampil); versi baru entri. */
  onSaved?: (version: number) => void;
  returnFocus?: HTMLElement | null;
  /** Jam untuk waktu relatif konflik (tes/galeri); bawaan jam perangkat. */
  now?: () => Date;
}

/** Satu sesi = satu kali sheet dibuka: draf dan clientId lahir baru setiap kali dibuka. */
export function EditSheet(props: EditSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <EditSession key={session} {...props} />;
}

function EditSession({
  open,
  onOpenChange,
  ruang,
  entry,
  accounts,
  categories,
  today,
  me,
  source,
  onSaved,
  returnFocus,
  now = () => new Date(),
}: EditSheetProps) {
  const e = useEditEntry({ entry, accounts, categories, me, source });
  const { draft, status, base } = e;
  const only = amountOnly(base);
  const saving = e.saving;
  const label = RUANG_NAME[ruang];
  const amountRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const accountRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLSelectElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const formId = useId();
  const alertId = useId();
  const saldoId = useId();
  const fieldErrorId = useId();
  const noteId = useId();
  const overwriteHintId = useId();
  const [page, setPage] = useState<'form' | 'kategori'>('form');
  const refocus = useRef<'chosen' | 'more' | 'amount' | null>(null);
  const [clock, setClock] = useState<Date>(now);

  useEffect(() => {
    const where = refocus.current;
    if (where === null) return;
    refocus.current = null;
    if (where === 'more') moreRef.current?.focus();
    else if (where === 'amount') amountRef.current?.focus();
    else chipsRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  });

  // Jawaban simpan tiba: konflik → Muat ulang (kotak digulir ke pandangan); galat kolom → kolomnya;
  // lainnya → tombol kaki. `not_found`/`voided` → Tutup (tombol utama nonaktif).
  const lastStatus = useRef(status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = status;
    if (was !== 'menyimpan' || status === 'menyimpan') return;
    if (status === 'konflik') {
      noticeRef.current?.scrollIntoView({ block: 'nearest' });
      primaryRef.current?.focus();
    } else if (status === 'field' && e.fieldCode === 'category_archived') {
      chipsRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
    } else if (status === 'field') {
      (e.fieldCode === 'before_opening' ? dateRef : accountRef).current?.focus();
    } else if (status === 'galat' && (e.galat === 'not_found' || e.galat === 'voided')) {
      primaryRef.current
        ?.closest('[role="dialog"]')
        ?.querySelector<HTMLElement>('button[aria-label="Tutup"]')
        ?.focus();
    } else if (status !== 'idle') primaryRef.current?.focus();
  }, [status, e.fieldCode, e.galat]);

  const onSheetOpenChange = (next: boolean) => {
    if (!next && saving) return;
    onOpenChange(next);
  };

  const finish = (version: number) => {
    toast({ message: editedToast(label) });
    onOpenChange(false);
    onSaved?.(version);
  };

  async function submit(ev: SyntheticEvent) {
    ev.preventDefault();
    if (saving || !e.canSave) return;
    if (status === 'konflik') return;
    const run = status === 'galat' ? e.retry : status === 'saldo_kurang' ? e.saveAnyway : e.save;
    setClock(now());
    const out = await run();
    if (out?.ok !== true) return;
    // Tanpa perubahan: tutup saja; tidak ada yang tersimpan, jadi tanpa toast.
    if ('unchanged' in out) onOpenChange(false);
    else finish(out.version);
  }

  async function overwrite() {
    if (!e.canOverwrite) return;
    setClock(now());
    const out = await e.overwrite();
    if (out?.ok === true && 'version' in out) finish(out.version);
  }

  if (page === 'kategori') {
    return (
      <Sheet
        open={open}
        onOpenChange={onSheetOpenChange}
        title={EDIT_COPY.title}
        titleHidden
        tint={ruang}
        headerStart={
          <>
            <IconButton
              label="Kembali ke Ubah transaksi"
              icon={<ArrowLeftIcon size={20} />}
              onClick={() => {
                setPage('form');
                refocus.current = 'more';
              }}
            />
            <h3 className="min-w-0 truncate text-subheading font-extrabold">{`Kategori · ${label}`}</h3>
          </>
        }
        returnFocus={returnFocus}
        fill
      >
        <Combobox
          label="Cari kategori"
          placeholder="Ketik nama kategori"
          emptyText="Tidak ada kategori dengan nama itu."
          items={e.allCategories.map((c) => ({
            value: c.id,
            label: c.name,
            icon: <CategoryIcon name={c.name} size={20} />,
          }))}
          onSelect={(id) => {
            e.setCategory(id);
            setPage('form');
            refocus.current = 'chosen';
          }}
          onCancel={() => {
            setPage('form');
            refocus.current = 'more';
          }}
        />
      </Sheet>
    );
  }

  const conflict = e.conflict;
  const blocked = e.galat === 'not_found' || e.galat === 'voided';
  const primaryLabel =
    status === 'galat' && !blocked
      ? CATAT_COPY.cobaLagi
      : status === 'saldo_kurang'
        ? CATAT_COPY.tetapSimpan
        : EDIT_COPY.save;
  const saldoText =
    e.saldo === null || draft.amount === null
      ? null
      : saldoKurangText(e.saldo.account.name, e.saldo.account.balance, e.saldo.after);
  const describedBy =
    [status === 'galat' || conflict !== null ? alertId : null, saldoText === null ? null : saldoId]
      .filter((x) => x !== null)
      .join(' ') || undefined;

  const overwriteHint = e.canOverwrite
    ? null
    : draft.amount === null || draft.amount <= 0
      ? EDIT_COPY.overwriteNeedsAmount
      : EDIT_COPY.overwriteNeedsCategory;

  const primaryClass =
    'flex-1 aria-disabled:border-hairline aria-disabled:bg-surface-2 aria-disabled:text-text-muted aria-disabled:hover-pointer:bg-surface-2';

  const footer = (
    <>
      {status === 'galat' && e.galat !== null ? (
        <CatatAlert id={alertId} tone="danger">
          {editGalatText(e.galat)}
        </CatatAlert>
      ) : null}
      <p role="status" className="sr-only">
        {saving ? CATAT_COPY.menyimpan : ''}
      </p>
      {conflict !== null && status === 'konflik' && overwriteHint !== null ? (
        <p
          id={overwriteHintId}
          className="flex items-center gap-1.5 text-caption font-medium text-text-muted"
        >
          <InfoIcon size={14} className="shrink-0" />
          {overwriteHint}
        </p>
      ) : null}
      {conflict !== null && status === 'konflik' ? (
        // Ditumpuk di HP: "Timpa dengan perubahan saya" tidak muat setengah lebar 360 (temuan reviewer).
        <div className="flex flex-col gap-2 tablet:flex-row">
          <Button
            ref={primaryRef}
            className="flex-1"
            aria-describedby={alertId}
            onClick={() => {
              e.reload();
              refocus.current = 'amount';
            }}
          >
            {EDIT_COPY.reload}
          </Button>
          <Button
            variant="secondary"
            className={`${primaryClass} whitespace-normal`}
            aria-disabled={!e.canOverwrite || undefined}
            aria-describedby={overwriteHint === null ? undefined : overwriteHintId}
            onClick={() => {
              void overwrite();
            }}
          >
            {EDIT_COPY.overwrite}
          </Button>
        </div>
      ) : (
        <Button
          ref={primaryRef}
          type="submit"
          form={formId}
          aria-disabled={saving || !e.canSave || undefined}
          aria-busy={saving || undefined}
          aria-describedby={describedBy}
          className={primaryClass}
        >
          {saving ? <SavingLabel /> : primaryLabel}
        </Button>
      )}
    </>
  );

  const opened = e.selectedAccount?.openedOn;
  const dates = [
    ...new Set([
      ...Array.from({ length: DATE_CHOICES }, (_, i) => addDays(today, -i)),
      draft.date,
      base.occurredOn,
    ]),
  ]
    .filter((d) => d <= today && (opened === undefined || d >= opened || d === draft.date))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  const categoryError =
    status === 'field' && e.fieldCode === 'category_archived' && e.archivedCategory !== null
      ? categoryArchivedText(e.archivedCategory.name)
      : null;
  const fieldError =
    status !== 'field' || e.selectedAccount === undefined || e.fieldCode === 'category_archived'
      ? null
      : e.fieldCode === 'before_opening'
        ? beforeOpeningText(e.selectedAccount.name, e.selectedAccount.openedOn)
        : accountArchivedText(e.selectedAccount.name);
  const kind = KIND_NAME[base.kind as keyof typeof KIND_NAME];

  return (
    <Sheet
      open={open}
      onOpenChange={onSheetOpenChange}
      title={EDIT_COPY.title}
      tint={ruang}
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
        <p className="-mt-1 flex items-center gap-2 text-label font-semibold text-text-soft">
          <span>{kind}</span>
          <SpaceTag space={ruang} />
        </p>
        <MoneyInput
          label="Nominal"
          labelHidden
          size="hero"
          inputRef={amountRef}
          value={draft.amount}
          onChange={e.setAmount}
          readOnly={saving}
        />
        {only ? (
          <dl className="flex flex-col gap-1 text-label font-semibold text-text">
            <div className="flex justify-between gap-3">
              <dt className="text-text-muted">Dompet</dt>
              <dd className="text-right">{base.accountName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-muted">Tanggal</dt>
              <dd className="text-right">{dayLabel(base.occurredOn, today)}</dd>
            </div>
          </dl>
        ) : (
          <>
            <div ref={chipsRef}>
              <CategoryChips
                chips={e.chips}
                all={e.allCategories}
                value={draft.categoryId}
                onChange={e.setCategory}
                moreRef={moreRef}
                busy={saving}
                invalid={categoryError !== null}
                describedBy={categoryError === null ? undefined : fieldErrorId}
                onMore={() => {
                  setPage('kategori');
                }}
              />
            </div>
            {categoryError === null ? null : (
              <FieldErrorText id={fieldErrorId}>{categoryError}</FieldErrorText>
            )}
            <div className="flex gap-2">
              <MetaSelect
                label={base.kind === 'income' ? 'Ke dompet' : 'Dari dompet'}
                icon={<WalletIcon size={18} />}
                value={draft.accountId}
                onChange={e.setAccount}
                options={[
                  ...e.accountOptions.map((a) => ({ value: a.id, label: a.name })),
                  ...(e.accountOptions.some((a) => a.id === draft.accountId)
                    ? []
                    : [{ value: draft.accountId, label: base.accountName }]),
                ]}
                selectRef={accountRef}
                busy={saving}
                invalid={e.fieldCode === 'account_archived'}
                describedBy={e.fieldCode === 'account_archived' ? fieldErrorId : undefined}
              />
              <MetaSelect
                label="Tanggal"
                icon={<CalendarBlankIcon size={18} />}
                value={draft.date}
                dataDate={draft.date}
                onChange={e.setDate}
                options={dates.map((d) => ({ value: d, label: dayLabel(d, today) }))}
                selectRef={dateRef}
                busy={saving}
                invalid={e.fieldCode === 'before_opening'}
                describedBy={e.fieldCode === 'before_opening' ? fieldErrorId : undefined}
              />
            </div>
            {fieldError === null ? null : (
              <FieldErrorText id={fieldErrorId}>{fieldError}</FieldErrorText>
            )}
          </>
        )}
        {saldoText === null ? null : <SaldoKurangRow id={saldoId}>{saldoText}</SaldoKurangRow>}
        {only ? null : (
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={noteId} optional>
              Keterangan
            </FieldLabel>
            <input
              id={noteId}
              type="text"
              autoComplete="off"
              maxLength={200}
              placeholder="Contoh: kopi sore"
              value={draft.description}
              readOnly={saving || undefined}
              aria-disabled={saving || undefined}
              onChange={(ev) => {
                e.setDescription(ev.target.value);
              }}
              className="min-h-12 w-full min-w-0 rounded-lg border border-border bg-bg px-3.5 text-body font-medium text-text outline-none placeholder:text-text-muted focus:border-2 focus:border-focus aria-disabled:border-hairline aria-disabled:text-text-muted"
            />
          </div>
        )}
        {conflict !== null && status === 'konflik' ? (
          <div ref={noticeRef}>
            <ConflictNotice
              id={alertId}
              latest={conflict.latest}
              by={conflict.by}
              at={conflict.at}
              before={conflict.before}
              today={today}
              now={clock}
            />
          </div>
        ) : null}
      </form>
    </Sheet>
  );
}
