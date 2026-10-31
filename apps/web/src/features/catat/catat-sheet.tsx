'use client';

import type { DemoState, DemoStore, Entry, Ruang } from '@dompetku/demo-data';
import { addDays, dayLabel, formatRupiah, type IsoDate, type Rupiah } from '@dompetku/domain';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Combobox } from '@/components/ui/combobox';
import { FieldLabel } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { ArrowLeftIcon } from '@/components/ui/icons/arrow-left';
import { ArrowsLeftRightIcon } from '@/components/ui/icons/arrows-left-right';
import { CalendarBlankIcon } from '@/components/ui/icons/calendar-blank';
import { InfoIcon } from '@/components/ui/icons/info';
import { NotePencilIcon } from '@/components/ui/icons/note-pencil';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { MoneyInput } from '@/components/ui/money-input';
import { Sheet } from '@/components/ui/sheet';
import { toast } from '@/components/ui/toast';
import { AppKeypad } from './app-keypad';
import { CategoryChips } from './category-chips';
import { TYPE_TITLE, TypeMenu, TypeMenuButton } from './type-menu';
import { useCatat, type CatatType } from './use-catat';
import { useKeyboardMode } from './use-keyboard-mode';
import { DestinationChips, MetaSelect } from './wallet-picker';

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
  const noteRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const noteId = useId();
  const errorId = useId();
  const hintId = useId();
  const typeHintId = useId();
  const [page, setPage] = useState<'form' | 'kategori'>('form');
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  // Setelah halaman kategori ditutup: fokus ke chip terpilih (pilih) atau "Kategori lain…" (kembali).
  const refocus = useRef<'chosen' | 'more' | 'note' | null>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const compact = useKeyboardMode(open) && keypad === 'os';
  const label = ruangLabel[draft.ruang];
  const target = other(draft.ruang);
  const title = `${TYPE_TITLE[draft.type]} · ${label}`;

  useEffect(() => {
    const where = refocus.current;
    if (where === null) return;
    refocus.current = null;
    if (where === 'more') moreRef.current?.focus();
    else if (where === 'note') noteRef.current?.focus();
    else chipsRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  });

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

  const hasAccounts = c.accounts.length > 0;
  const isTransfer = draft.type === 'transfer';
  const hasAmount = draft.amount !== null && draft.amount > 0;
  const missing = isTransfer
    ? draft.counterAccountId === undefined
    : draft.categoryId === undefined;
  const showHint = hasAmount && missing;

  if (page === 'kategori') {
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        titleHidden
        tint={draft.ruang}
        headerStart={
          <>
            <IconButton
              label="Kembali ke Catat"
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
          items={c.allCategories.map((cat) => ({
            value: cat.id,
            label: cat.name,
            icon: <CategoryIcon name={cat.name} size={20} />,
          }))}
          onSelect={(id) => {
            c.setCategory(id);
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

  const footer = hasAccounts ? (
    <>
      {keypad === 'app' ? <AppKeypad value={draft.amount} onChange={c.setAmount} /> : null}
      {c.error === null ? null : (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-label font-semibold text-danger"
        >
          <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
          {c.error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="text"
          size="sm"
          className="px-2.5"
          onClick={() => {
            c.switchRuang(target);
          }}
        >
          <ArrowsLeftRightIcon size={18} weight="bold" />
          Pindah ke {ruangLabel[target]}
        </Button>
        <Button
          type="submit"
          form={formId}
          size={compact ? 'sm' : 'md'}
          disabled={!c.canSave}
          aria-describedby={
            [c.error === null ? null : errorId, showHint ? hintId : null]
              .filter((x) => x !== null)
              .join(' ') || undefined
          }
          className="flex-1"
        >
          Simpan
          <kbd
            aria-hidden="true"
            className="ml-auto hidden rounded-sm border border-current px-1.5 py-0.5 font-mono text-tag font-bold laptop:inline"
          >
            ↵
          </kbd>
        </Button>
      </div>
      <p className="hidden text-caption font-medium text-text-muted laptop:block">
        Enter untuk simpan · Esc untuk menutup
      </p>
    </>
  ) : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      titleContent={
        hasAccounts ? (
          <TypeMenuButton
            ref={titleRef}
            space={draft.ruang}
            title={title}
            open={menuOpen}
            describedBy={typeHintId}
            onToggle={() => {
              setMenuOpen((o) => !o);
            }}
          />
        ) : undefined
      }
      headerAction={
        <>
          <span id={typeHintId} className="sr-only">
            Ganti jenis transaksi
          </span>
          {menuOpen ? (
            <TypeMenu
              value={draft.type}
              onChange={(t: CatatType) => {
                c.setType(t);
              }}
              onClose={() => {
                setMenuOpen(false);
                titleRef.current?.focus();
              }}
              ignore={titleRef}
            />
          ) : null}
        </>
      }
      tint={draft.ruang}
      footer={footer}
      initialFocus={hasAccounts ? amountRef : undefined}
      returnFocus={returnFocus}
      fill
      compact={compact}
    >
      {hasAccounts ? (
        <form
          id={formId}
          onSubmit={submit}
          className={`flex flex-col ${compact ? 'gap-2' : 'gap-3'}`}
        >
          <MoneyInput
            label="Nominal"
            labelHidden
            size={compact ? 'compact' : 'hero'}
            inputMode={keypad === 'app' ? 'none' : 'numeric'}
            inputRef={amountRef}
            value={draft.amount}
            onChange={c.setAmount}
          />
          {isTransfer ? (
            <DestinationChips
              accounts={c.destinations}
              value={draft.counterAccountId}
              onChange={c.setCounterAccount}
            />
          ) : (
            <div ref={chipsRef}>
              <CategoryChips
                chips={c.chips}
                all={c.allCategories}
                value={draft.categoryId}
                onChange={c.setCategory}
                moreRef={moreRef}
                onMore={() => {
                  setPage('kategori');
                }}
              />
            </div>
          )}
          {showHint ? (
            <p
              id={hintId}
              className="flex items-center gap-1.5 text-caption font-medium text-text-muted"
            >
              <InfoIcon size={14} className="shrink-0" />
              {isTransfer
                ? 'Pilih dompet tujuan untuk menyimpan'
                : 'Pilih kategori untuk menyimpan'}
            </p>
          ) : null}
          <div className="flex gap-2">
            <MetaSelect
              label={draft.type === 'income' ? 'Ke dompet' : 'Dari dompet'}
              icon={<WalletIcon size={18} />}
              value={draft.accountId}
              onChange={c.setAccount}
              options={c.accounts.map((a) => ({ value: a.id, label: a.name }))}
            />
            <MetaSelect
              label="Tanggal"
              icon={<CalendarBlankIcon size={18} />}
              value={draft.date}
              dataDate={draft.date}
              onChange={c.setDate}
              options={Array.from({ length: DATE_CHOICES }, (_, i) => addDays(today, -i)).map(
                (d) => ({ value: d, label: dayLabel(d, today) }),
              )}
            />
            <IconButton
              label="Tambah keterangan"
              icon={<NotePencilIcon size={20} />}
              aria-expanded={noteOpen}
              aria-controls={noteId}
              className="tablet:hidden"
              onClick={() => {
                setNoteOpen((o) => !o);
                refocus.current = noteOpen ? null : 'note';
              }}
            />
          </div>
          <div className={`flex-col gap-1.5 ${noteOpen ? 'flex' : 'hidden tablet:flex'}`}>
            <FieldLabel htmlFor={noteId} optional>
              Keterangan
            </FieldLabel>
            <input
              id={noteId}
              ref={noteRef}
              type="text"
              autoComplete="off"
              placeholder="Contoh: kopi sore"
              value={draft.description ?? ''}
              onChange={(e) => {
                c.setDescription(e.target.value);
              }}
              className="min-h-12 w-full min-w-0 rounded-lg border border-border bg-bg px-3.5 text-body font-medium text-text outline-none placeholder:text-text-muted focus:border-2 focus:border-focus"
            />
          </div>
        </form>
      ) : (
        <p className="text-body font-medium text-text-soft">
          Belum ada dompet di {label}. Tambahkan dompet dulu, lalu catat dari sini.
        </p>
      )}
    </Sheet>
  );
}
