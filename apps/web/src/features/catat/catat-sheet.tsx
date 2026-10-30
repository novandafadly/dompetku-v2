'use client';

import type { DemoState, DemoStore, Entry, Ruang } from '@dompetku/demo-data';
import { addDays, dayLabel, formatRupiah, type IsoDate, type Rupiah } from '@dompetku/domain';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { focusRing } from '@/components/ui/styles';
import { toast } from '@/components/ui/toast';
import { AppKeypad } from './app-keypad';
import { CategoryChips } from './category-chips';
import { useCatat, type CatatType } from './use-catat';
import { DestinationChips, WalletSelect } from './wallet-picker';

export interface CatatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ruang tujuan saat sheet dibuka. */
  ruang: Ruang;
  state: DemoState;
  store: DemoStore;
  today: IsoDate;
  keypad: 'os' | 'app';
  ruangLabel: Record<Ruang, string>;
  /** Ke mana fokus kembali saat sheet ditutup. */
  returnFocus?: HTMLElement | null;
  /** Nominal yang diketik di placeholder sebelum kode sheet termuat. */
  initialAmount?: Rupiah | null;
}

const TYPE_TITLE: Record<CatatType, string> = {
  expense: 'Pengeluaran',
  income: 'Pemasukan',
  transfer: 'Transfer',
};

const TYPE_ITEMS = [
  { value: 'expense', label: 'Keluar' },
  { value: 'income', label: 'Masuk' },
  { value: 'transfer', label: 'Transfer' },
];

const isType = (v: string): v is CatatType => v in TYPE_TITLE;

/** Hari ini dan 13 hari ke belakang; mencatat ke masa depan tidak ditawarkan. */
const DATE_CHOICES = 14;

const other = (r: Ruang): Ruang => (r === 'pribadi' ? 'bersama' : 'pribadi');

function savedMessage(state: DemoState, entry: Entry, label: string): string {
  const name = (id: string | undefined) => state.accounts.find((a) => a.id === id)?.name ?? '';
  const head = `Tersimpan di ${label} · ${formatRupiah(entry.amount)}`;
  switch (entry.kind) {
    case 'income':
      return `${head} ke ${name(entry.accountId)}`;
    case 'transfer':
      return `${head} dari ${name(entry.accountId)} ke ${name(entry.counterAccountId)}`;
    default:
      return `${head} dari ${name(entry.accountId)}`;
  }
}

/** Satu sesi = satu kali sheet dibuka: draf dan clientId lahir baru setiap kali dibuka. */
export function CatatSheet(props: CatatSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <CatatSession key={session} {...props} />;
}

function CatatSession({
  open,
  onOpenChange,
  ruang,
  state,
  store,
  today,
  keypad,
  ruangLabel,
  returnFocus,
  initialAmount,
}: CatatSheetProps) {
  const c = useCatat({ state, store, today, ruang, initialAmount });
  const { draft } = c;
  const amountRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const dateId = useId();
  const noteId = useId();
  const errorId = useId();
  const label = ruangLabel[draft.ruang];
  const target = other(draft.ruang);

  function submit(e: SyntheticEvent) {
    e.preventDefault();
    const entry = c.save();
    if (entry === null) return;
    toast({
      message: savedMessage(state, entry, label),
      action: {
        label: 'Urungkan',
        onAction: () => {
          store.voidEntry(entry.id);
        },
      },
    });
    onOpenChange(false);
  }

  const switchButton = (
    <button
      type="button"
      onClick={() => {
        c.switchRuang(target);
      }}
      className={`min-h-11 shrink-0 rounded-field px-2 text-sm font-semibold text-text underline ${focusRing}`}
    >
      Pindah ke {ruangLabel[target]}
    </button>
  );

  const hasAccounts = c.accounts.length > 0;
  const footer = hasAccounts ? (
    <>
      {c.error === null ? null : (
        <p id={errorId} role="alert" className="mb-2 text-base text-danger">
          {c.error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <WalletSelect
          direction={draft.type === 'income' ? 'Ke' : 'Dari'}
          accounts={c.accounts}
          value={draft.accountId}
          onChange={c.setAccount}
        />
        <Button
          type="submit"
          form={formId}
          disabled={!c.canSave}
          aria-describedby={c.error === null ? undefined : errorId}
        >
          Simpan
        </Button>
      </div>
      {keypad === 'app' ? <AppKeypad value={draft.amount} onChange={c.setAmount} /> : null}
    </>
  ) : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`${TYPE_TITLE[draft.type]} · ${label}`}
      tint={draft.ruang}
      headerAction={switchButton}
      footer={footer}
      initialFocus={hasAccounts ? amountRef : undefined}
      returnFocus={returnFocus}
      fill
    >
      {hasAccounts ? (
        <form id={formId} onSubmit={submit} className="flex flex-col gap-2">
          <SegmentedControl
            label="Jenis transaksi"
            items={TYPE_ITEMS}
            value={draft.type}
            onChange={(v) => {
              if (isType(v)) c.setType(v);
            }}
          />
          <MoneyInput
            label="Nominal"
            labelHidden
            size="hero"
            inputMode={keypad === 'app' ? 'none' : 'numeric'}
            inputRef={amountRef}
            value={draft.amount}
            onChange={c.setAmount}
          />
          {draft.type === 'transfer' ? (
            <DestinationChips
              accounts={c.destinations}
              value={draft.counterAccountId}
              onChange={c.setCounterAccount}
            />
          ) : (
            <CategoryChips
              chips={c.chips}
              all={c.allCategories}
              value={draft.categoryId}
              onChange={c.setCategory}
            />
          )}
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={dateId} className="text-sm text-text-muted">
                Tanggal
              </label>
              <select
                id={dateId}
                data-date={draft.date}
                value={draft.date}
                onChange={(e) => {
                  c.setDate(e.target.value);
                }}
                className={`min-h-11 rounded-field border border-border bg-surface px-2 text-lg text-text ${focusRing}`}
              >
                {Array.from({ length: DATE_CHOICES }, (_, i) => addDays(today, -i)).map((d) => (
                  <option key={d} value={d}>
                    {dayLabel(d, today)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor={noteId} className="text-sm text-text-muted">
                Keterangan (opsional)
              </label>
              <input
                id={noteId}
                type="text"
                autoComplete="off"
                value={draft.description ?? ''}
                onChange={(e) => {
                  c.setDescription(e.target.value);
                }}
                className={`min-h-11 w-full min-w-0 rounded-field border border-border bg-surface px-3 text-lg text-text ${focusRing}`}
              />
            </div>
          </div>
        </form>
      ) : (
        <p className="text-base text-text-muted">
          Belum ada dompet di {label}. Tambahkan dompet dulu, lalu catat dari sini.
        </p>
      )}
    </Sheet>
  );
}
